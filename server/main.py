"""
BrowserAide - modular entrypoint.

Run with:
    cd server
    uvicorn main:app --host 127.0.0.1 --port 8004 --reload

Or:
    python main.py
"""

import json
import time
from datetime import datetime
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse

from core import (
    Config,
    BrowserControlMode,
    StepRequest,
    StepResponse,
    ModeChangeRequest,
    ResetRequest,
    VLMTestRequest,
    AgentMemory,
)

from services import VLMClient, PromptBuilder, ActionParser
from services.stream_extractors import (
    extract_partial_finish_answer,
    extract_partial_thought_stream,
)
from core.protocol import MODEL_OUTPUT_SCHEMA_VERSION, STEP_RESPONSE_SCHEMA_VERSION
from utils import debug_logger, get_action_signature, check_task_completion


class SessionManager:
    """Manage AgentMemory instances for concurrent sessions."""

    DEFAULT_SESSION = "default"

    def __init__(self):
        self._sessions: dict[str, AgentMemory] = {}
        self._session_last_access: dict[str, float] = {}

    def get_memory(self, session_id: str = None) -> AgentMemory:
        """Return a session memory object, creating it when needed."""
        sid = session_id or self.DEFAULT_SESSION

        if sid not in self._sessions:
            self._sessions[sid] = AgentMemory()
            print(f"[Agent Session] Created new session: {sid}")

        self._session_last_access[sid] = time.time()
        return self._sessions[sid]

    def reset_session(self, session_id: str = None) -> bool:
        """Reset one session memory object."""
        sid = session_id or self.DEFAULT_SESSION

        if sid in self._sessions:
            self._sessions[sid].reset()
            print(f"[Agent Session] Reset session: {sid}")
        else:
            self._sessions[sid] = AgentMemory()
            print(f"[Agent Session] Created fresh session: {sid}")

        return True

    def list_sessions(self) -> list[dict]:
        """List active sessions with last-access metadata."""
        now = time.time()
        return [
            {
                "session_id": sid,
                "last_access": self._session_last_access.get(sid, 0),
                "age_seconds": now - self._session_last_access.get(sid, now)
            }
            for sid in self._sessions.keys()
        ]

    def cleanup_old_sessions(self, max_age_seconds: int = 3600):
        """Remove non-default sessions older than the configured age."""
        now = time.time()
        to_remove = [
            sid for sid, last in self._session_last_access.items()
            if now - last > max_age_seconds and sid != self.DEFAULT_SESSION
        ]
        for sid in to_remove:
            del self._sessions[sid]
            del self._session_last_access[sid]
            print(f"[Agent Session] Cleaned up expired session: {sid}")
        return len(to_remove)


session_manager = SessionManager()
vlm_client = VLMClient()
action_parser = ActionParser()

current_control_mode = BrowserControlMode(Config.BROWSER_CONTROL_MODE)

LONG_OUTPUT_HINTS = (
    "summary", "summarize", "summarise", "report", "table", "list",
    "汇总", "总结", "整理", "列出", "表格", "清单", "报告",
)


def _get_runtime_context(memory: AgentMemory, session_id: str = None) -> dict:
    """Build runtime metadata from the local system clock."""
    now = datetime.now().astimezone()
    return {
        "current_datetime": now.isoformat(timespec="seconds"),
        "date": now.date().isoformat(),
        "time": now.time().isoformat(timespec="seconds"),
        "timezone": str(now.tzinfo),
        "utc_offset": now.strftime("%z"),
        "step_index": len(memory.step_records) + 1,
        "session_id": session_id or SessionManager.DEFAULT_SESSION,
    }


def _select_max_tokens(request: StepRequest, history_steps: list[dict]) -> int:
    """
    Use a lower token budget for normal control steps and only expand it for
    summary-heavy steps, especially right after extract_page_text().
    """
    max_cap = max(1, Config.VLM_MAX_TOKENS)
    default_budget = min(max_cap, max(1, Config.VLM_DEFAULT_STEP_MAX_TOKENS))
    summary_budget = min(max_cap, max(default_budget, Config.VLM_SUMMARY_STEP_MAX_TOKENS))

    instruction = (request.instruction or "").lower()
    last_action = ""
    if history_steps:
        last_action = str(history_steps[-1].get("action_summary") or "").lower()

    extracted_len = len(request.extracted_text or "")
    has_long_extract = extracted_len >= Config.VLM_LARGE_EXTRACT_THRESHOLD_CHARS
    looks_like_summary_task = any(hint in instruction for hint in LONG_OUTPUT_HINTS)
    follows_extract = "extract_page_text" in last_action or "extract_text" in last_action

    if has_long_extract or follows_extract or looks_like_summary_task:
        return summary_budget
    return default_budget


def _get_vlm_client(request: StepRequest) -> VLMClient:
    if request.api_key or request.base_url or request.model_name:
        return VLMClient(
            api_key=request.api_key or None,
            base_url=request.base_url or None,
            model=request.model_name or None,
        )
    return vlm_client


app = FastAPI(
    title="BrowserAide API",
    description="Three-mode web automation agent (DOM/Visual/Hybrid) - Inspired by UI-TARS",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"[Agent Server] Validation Error:")
    for error in exc.errors():
        print(f"  - Field: {error.get('loc')}, Error: {error.get('msg')}, Type: {error.get('type')}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()}
    )


@app.on_event("startup")
async def startup_event():
    debug_logger.start_session()
    print(f"[Agent Server] Started with mode: {current_control_mode.value}")
    print(f"[Agent Server] Debug logging: {'enabled' if Config.DEBUG_SAVE_INPUTS else 'disabled'}")


def _resolve_control_mode(request: StepRequest) -> BrowserControlMode:
    if request.control_mode:
        try:
            return BrowserControlMode(request.control_mode)
        except ValueError:
            return current_control_mode
    return current_control_mode


def _resolve_prompt_language(request: StepRequest) -> str:
    """Resolve prompt language from the user's instruction."""
    instruction = request.instruction or ""
    has_cjk = any("\u4e00" <= char <= "\u9fff" for char in instruction)
    return "zh" if has_cjk else "en"


async def _prepare_step(request: StepRequest, mode: BrowserControlMode) -> dict:
    """Prepare memory, prompt messages, and debug logs for one step."""
    memory = session_manager.get_memory(request.session_id)
    if request.session_id:
        print(f"[Agent Server] Session: {request.session_id}")

    scroll_info = request.scroll_info.model_dump() if request.scroll_info else None
    memory.update_last_action_feedback(
        request.screenshot,
        scroll_info=scroll_info,
        dom_elements=request.dom_elements,
        extracted_text=request.extracted_text,
        url=request.url,
        title=request.title,
        last_action_result=request.last_action_result,
        max_consecutive_failures=request.max_consecutive_failures
    )
    memory.remember_extracted_text(request.extracted_text)

    images = memory.add_screenshot(request.screenshot)
    history = memory.get_formatted_history()
    history_steps = memory.get_structured_history()
    runtime_context = _get_runtime_context(memory, request.session_id)
    language = _resolve_prompt_language(request)
    runtime_context["language"] = language
    browser_context = {
        "url": request.url,
        "title": request.title,
        "viewport": {
            "width": request.width,
            "height": request.height,
        },
    }

    prompt_start = time.time()
    dom_count = len(request.dom_elements) if request.dom_elements else 0

    max_images = Config.MAX_IMAGE_HISTORY
    total_images = len(images)
    image_stats = {
        "total": total_images,
        "kept": min(total_images, max_images),
        "omitted": max(0, total_images - max_images)
    }

    text_prompt = PromptBuilder.build_text_prompt(
        instruction=request.instruction,
        history=history,
        history_steps=history_steps,
        memory_warnings=memory.get_warnings(),
        runtime_context=runtime_context,
        browser_context=browser_context,
        scroll_info=scroll_info,
        dom_elements=request.dom_elements if mode != BrowserControlMode.VISUAL else None,
        mode=mode,
        image_stats=image_stats,
        extracted_text=request.extracted_text,
        extracted_text_summary=memory.get_extracted_text_summary(),
        language=language,
    )
    messages = PromptBuilder.build_multimodal_messages(text_prompt, images)
    selected_max_tokens = _select_max_tokens(request, history_steps)
    prompt_build_ms = (time.time() - prompt_start) * 1000

    prompt_chars = len(text_prompt)
    extracted_info = f" | Extracted text: {len(request.extracted_text)} chars" if request.extracted_text else ""
    print(f"[Agent Perf] Perceive: DOM | DOM elements: {dom_count} items{extracted_info}")
    print(
        f"[Agent Perf] Prompt: {prompt_chars} chars | Build time: {prompt_build_ms:.1f}ms"
        f" | max_tokens: {selected_max_tokens}"
    )

    debug_logger.save_step(
        text_prompt=text_prompt,
        images=images,
        instruction=request.instruction,
        viewport={"width": request.width, "height": request.height},
        extra_metadata={
            "control_mode": mode.value,
            "prompt_chars": prompt_chars,
            "dom_count": dom_count,
            "max_tokens": selected_max_tokens,
            "model_override": bool(request.model_name),
            "base_url_override": bool(request.base_url),
            "api_key_override": bool(request.api_key),
            "max_consecutive_failures": request.max_consecutive_failures,
        }
    )

    return {
        "memory": memory,
        "images": images,
        "messages": messages,
        "text_prompt": text_prompt,
        "scroll_info": scroll_info,
        "dom_count": dom_count,
        "prompt_build_ms": prompt_build_ms,
        "runtime": runtime_context,
        "max_tokens": selected_max_tokens,
    }


def _has_action(actions: list[dict], *action_types: str) -> bool:
    """Return whether any parsed action has one of the requested types."""
    expected = {action_type.lower() for action_type in action_types}
    return any(str(action.get("action_type", "")).lower() in expected for action in actions)


def _resolve_step_outcome(parsed: dict, force_stop: bool = False, stop_reason: str = None) -> dict:
    """Resolve completion and final-answer semantics from parsed model output."""
    actions = parsed.get("actions") or []
    parsed_status = parsed.get("status") or {}
    state = parsed_status.get("state") or "running"

    finished_by_action, action_answer = check_task_completion(actions, parsed.get("thought", ""))
    final_answer = parsed.get("final_answer") or action_answer

    should_stop = False
    if force_stop:
        should_stop = True
        final_answer = final_answer or f"Stopped by system: {stop_reason}"
    elif finished_by_action:
        should_stop = True
    elif state == "completed" or parsed_status.get("is_task_complete"):
        should_stop = True

    # waiting_for_user is intentionally not a completed stop: the extension must
    # execute call_user so it can pause and show the user-facing notification.
    if state == "waiting_for_user" or parsed_status.get("needs_user_input"):
        should_stop = False

    return {"should_stop": should_stop, "final_answer": final_answer}


def _post_process_step(
    memory: AgentMemory,
    request: StepRequest,
    parsed: dict,
    scroll_info: dict | None,
) -> dict:
    """Post-process VLM output, update loop detection, and record the step."""
    for action in parsed["actions"]:
        signature = get_action_signature(action)
        warning = memory.track_action(signature)
        if warning:
            print(f"[Agent Server] Loop detected: {signature}")

    screen_warning = memory.track_screen_change(request.screenshot)
    if screen_warning:
        print(f"[Agent Server] Screen unchanged warning triggered")

    should_stop_force, stop_reason = memory.should_force_stop(request.max_consecutive_failures)
    if should_stop_force:
        print(f"[Agent Server] Force stop triggered: {stop_reason}")
        parsed["thought"] = f"[SYSTEM STOP: {stop_reason}] {parsed['thought']}"

    result = _resolve_step_outcome(parsed, should_stop_force, stop_reason)

    if parsed["actions"][0]["action_type"] == "unknown":
        memory.add_message(
            "system",
            f"[System] Output format error. Please return {MODEL_OUTPUT_SCHEMA_VERSION} JSON with valid actions."
        )

    memory.record_action_step(
        action_summary=parsed["action_summary"],
        actions=parsed["actions"],
        thought=parsed["thought"],
        screenshot_b64=request.screenshot,
        scroll_info=scroll_info,
        dom_elements=request.dom_elements,
        extracted_text=request.extracted_text,
        url=request.url,
        title=request.title
    )

    return result


def _build_response_status(parsed: dict, should_stop: bool) -> dict:
    """Build the stable StepResponse status object."""
    status = dict(parsed.get("status") or {})
    state = status.get("state") or "running"

    if should_stop and state not in ("waiting_for_user", "failed"):
        state = "completed"

    status["state"] = state
    status["is_task_complete"] = bool(should_stop and state == "completed")
    status["needs_user_input"] = bool(state == "waiting_for_user" or status.get("needs_user_input"))
    status.setdefault("error", None)
    return status


def _log_performance(metrics: dict, is_sse: bool = False):
    label = " (SSE)" if is_sse else ""
    print(f"[Agent Perf] Performance Summary{label}:")
    print(f"[Agent Perf]    Prompt Build: {metrics['prompt_build_ms']:.1f}ms")
    print(f"[Agent Perf]    VLM TTFT:     {metrics['vlm_ttft_ms']:.1f}ms (Time to First Token)")
    print(f"[Agent Perf]    VLM TTLT:     {metrics['vlm_ttlt_ms']:.1f}ms (Total VLM Time)")
    print(f"[Agent Perf]    Parse:        {metrics['parse_ms']:.1f}ms")
    print(f"[Agent Perf]    Total:        {metrics['total_ms']:.1f}ms")


def _new_metrics() -> dict:
    return {
        "prompt_build_ms": 0,
        "vlm_ttft_ms": 0,
        "vlm_ttlt_ms": 0,
        "parse_ms": 0,
        "total_ms": 0,
    }

@app.post("/step", response_model=StepResponse)
async def step(request: StepRequest):
    """Return the complete step response after VLM inference finishes."""
    step_start = time.time()
    metrics = _new_metrics()

    try:
        mode = _resolve_control_mode(request)
        print(f"[Agent Server] Control mode: {mode.value}")

        ctx = await _prepare_step(request, mode)
        metrics["prompt_build_ms"] = ctx["prompt_build_ms"]

        request_vlm_client = _get_vlm_client(request)
        vlm_result = await request_vlm_client.infer_with_metrics(
            ctx["messages"],
            max_tokens=ctx["max_tokens"],
            use_streaming=True
        )
        vlm_output = vlm_result["content"]
        metrics["vlm_ttft_ms"] = vlm_result["ttft_ms"]
        metrics["vlm_ttlt_ms"] = vlm_result["ttlt_ms"]

        print(f"[Agent Perf] VLM TTFT: {metrics['vlm_ttft_ms']:.1f}ms | TTLT: {metrics['vlm_ttlt_ms']:.1f}ms")
        print(f"[Agent Server] VLM Response:\n{vlm_output[:500]}...")

        parse_start = time.time()
        parsed = action_parser.parse(
            vlm_output,
            request.width,
            request.height,
            dom_elements=request.dom_elements,
        )
        metrics["parse_ms"] = (time.time() - parse_start) * 1000

        ctx["memory"].add_message("assistant", vlm_output)
        debug_logger.save_output(vlm_output)

        result = _post_process_step(
            ctx["memory"], request, parsed, ctx["scroll_info"]
        )

        metrics["total_ms"] = (time.time() - step_start) * 1000
        _log_performance(metrics)

        return StepResponse(
            thought=parsed["thought"],
            thought_payload=parsed.get("thought_payload"),
            actions=parsed["actions"],
            action_summary=parsed["action_summary"],
            should_stop=result["should_stop"],
            final_answer=result["final_answer"],
            control_mode=mode.value,
            status=_build_response_status(parsed, result["should_stop"]),
            observation=parsed.get("observation") or {},
            runtime=ctx["runtime"],
            metrics=metrics,
        )

    except Exception as e:
        print(f"[Agent Server] Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/step/stream")
async def step_stream(request: StepRequest):
    """Stream VLM thinking over SSE, then emit the complete step response."""
    async def generate_sse():
        step_start = time.time()
        metrics = _new_metrics()

        try:
            mode = _resolve_control_mode(request)
            ctx = await _prepare_step(request, mode)
            metrics["prompt_build_ms"] = ctx["prompt_build_ms"]
            yield f"event: start\ndata: {json.dumps({'schema_version': 'agent.stream.event.v1', 'event': 'start', 'timestamp': step_start, 'runtime': ctx['runtime']})}\n\n"

            vlm_output = ""
            streamed_thought = ""
            streamed_answer = ""
            request_vlm_client = _get_vlm_client(request)
            async for event in request_vlm_client.infer_streaming_generator(
                ctx["messages"],
                max_tokens=ctx["max_tokens"]
            ):
                if event["type"] == "first_token":
                    metrics["vlm_ttft_ms"] = event["ttft_ms"]
                    yield f"event: first_token\ndata: {json.dumps({'schema_version': 'agent.stream.event.v1', 'event': 'first_token', 'ttft_ms': event['ttft_ms']})}\n\n"
                elif event["type"] == "chunk":
                    vlm_output = event["accumulated"]
                    thought_stream = extract_partial_thought_stream(vlm_output)
                    if len(thought_stream) > len(streamed_thought):
                        delta = thought_stream[len(streamed_thought):]
                        streamed_thought = thought_stream
                        yield f"event: thinking\ndata: {json.dumps({'schema_version': 'agent.stream.event.v1', 'event': 'thinking', 'content': delta, 'delta': delta, 'accumulated': streamed_thought}, ensure_ascii=False)}\n\n"

                    answer_stream = extract_partial_finish_answer(vlm_output)
                    if len(answer_stream) > len(streamed_answer):
                        delta = answer_stream[len(streamed_answer):]
                        streamed_answer = answer_stream
                        yield f"event: answer\ndata: {json.dumps({'schema_version': 'agent.stream.event.v1', 'event': 'answer', 'content': delta, 'delta': delta, 'accumulated': streamed_answer}, ensure_ascii=False)}\n\n"
                elif event["type"] == "complete":
                    vlm_output = event["content"]
                    metrics["vlm_ttlt_ms"] = event["ttlt_ms"]

            parse_start = time.time()
            parsed = action_parser.parse(
                vlm_output,
                request.width,
                request.height,
                dom_elements=request.dom_elements,
            )
            metrics["parse_ms"] = (time.time() - parse_start) * 1000

            if parsed["thought"] and not streamed_thought:
                streamed_thought = parsed["thought"]
                yield f"event: thinking\ndata: {json.dumps({'schema_version': 'agent.stream.event.v1', 'event': 'thinking', 'content': streamed_thought, 'delta': streamed_thought, 'accumulated': streamed_thought}, ensure_ascii=False)}\n\n"

            yield f"event: action\ndata: {json.dumps({'schema_version': 'agent.stream.event.v1', 'event': 'action', 'actions': parsed['actions'], 'action_summary': parsed['action_summary']})}\n\n"

            ctx["memory"].add_message("assistant", vlm_output)
            debug_logger.save_output(vlm_output)

            result = _post_process_step(
                ctx["memory"], request, parsed, ctx["scroll_info"]
            )

            metrics["total_ms"] = (time.time() - step_start) * 1000

            complete_data = {
                "schema_version": STEP_RESPONSE_SCHEMA_VERSION,
                "thought": parsed["thought"],
                "thought_payload": parsed.get("thought_payload"),
                "actions": parsed["actions"],
                "action_summary": parsed["action_summary"],
                "should_stop": result["should_stop"],
                "final_answer": result["final_answer"],
                "control_mode": mode.value,
                "status": _build_response_status(parsed, result["should_stop"]),
                "observation": parsed.get("observation") or {},
                "runtime": ctx["runtime"],
                "metrics": metrics,
            }
            yield f"event: complete\ndata: {json.dumps(complete_data)}\n\n"

            _log_performance(metrics, is_sse=True)

        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/reset")
async def reset(request: ResetRequest = None):
    """Reset agent memory state."""
    session_id = request.session_id if request else None
    session_manager.reset_session(session_id)
    debug_logger.reset()

    sid_info = f" (session: {session_id})" if session_id else ""
    return {"message": f"Agent memory reset successfully{sid_info}", "ok": True}


@app.post("/mode")
async def change_mode(request: ModeChangeRequest):
    """Change the active browser control mode."""
    global current_control_mode

    try:
        new_mode = BrowserControlMode(request.mode.lower())
        current_control_mode = new_mode
        print(f"[Agent Server] Control mode changed to: {new_mode.value}")
        return {
            "ok": True,
            "mode": new_mode.value,
            "message": f"Browser control mode changed to {new_mode.value}"
        }
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid mode: {request.mode}. Use 'dom', 'visual', or 'hybrid'"
        )


@app.get("/mode")
async def get_mode():
    """Return the active browser control mode."""
    return {
        "mode": current_control_mode.value,
        "available_modes": ["dom", "visual", "hybrid"]
    }


@app.get("/health")
async def health():
    """Return basic server health details."""
    default_memory = session_manager.get_memory()
    return {
        "status": "healthy",
        "version": "1",
        "model": Config.VLM_MODEL,
        "control_mode": current_control_mode.value,
        "memory": default_memory.get_stats(),
        "active_sessions": len(session_manager.list_sessions())
    }


@app.post("/vlm/test")
async def test_vlm_endpoint(request: VLMTestRequest):
    """Test whether the supplied VLM endpoint, credentials, and model work."""
    try:
        step_like_request = StepRequest(
            instruction="test",
            screenshot="",
            api_key=request.api_key,
            base_url=request.base_url,
            model_name=request.model_name,
        )
        client = _get_vlm_client(step_like_request)
        result = await client.test_connection()
        return {
            "ok": True,
            "model": result["model"],
            "message": "VLM endpoint is reachable",
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/sessions")
async def list_sessions():
    """List active sessions with last-access metadata."""
    return {
        "sessions": session_manager.list_sessions(),
        "count": len(session_manager.list_sessions())
    }


@app.post("/sessions/cleanup")
async def cleanup_sessions(max_age_seconds: int = 3600):
    """Clean up expired sessions."""
    cleaned = session_manager.cleanup_old_sessions(max_age_seconds)
    return {
        "cleaned": cleaned,
        "remaining": len(session_manager.list_sessions())
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=Config.SERVER_HOST,
        port=Config.SERVER_PORT
    )
