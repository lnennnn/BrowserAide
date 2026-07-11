"""Parse strict VLM JSON output into executable actions."""

import json
import re
from typing import Any, Optional, List, Dict, Tuple

from core.config import Config
from core.protocol import (
    MODEL_OUTPUT_SCHEMA_VERSION,
    get_action_group,
    get_action_required_inputs,
    is_supported_action,
)

INVALID_MODEL_OUTPUT_SCHEMA_VERSION = "invalid_model_output"


class ActionParser:
    """Strict parser for the agent.step.output.v1 model protocol."""

    def __init__(self, scale: int = None):
        self.scale = scale or Config.COORDINATE_SCALE

    def parse(
        self,
        vlm_output: str,
        viewport_width: int,
        viewport_height: int,
        dom_elements: List[Dict] = None,
    ) -> Dict[str, Any]:
        """Parse raw VLM output into the structured step response payload."""
        try:
            data = self._load_model_output_json(vlm_output)
            return self._parse_model_output(data, viewport_width, viewport_height, dom_elements)
        except ValueError as exc:
            print(f"[ActionParser] ❌ Invalid model output: {exc}")
            return self._invalid_result(str(exc))

    def _load_model_output_json(self, text: str) -> Dict[str, Any]:
        """Load exactly one JSON object. Markdown fences and legacy text are invalid."""
        raw = (text or "").strip()
        if not raw:
            raise ValueError("empty output")
        if raw.startswith("```"):
            raise ValueError("markdown fenced output is not allowed")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"output is not valid JSON: {exc.msg}") from exc
        if not isinstance(data, dict):
            raise ValueError("top-level output must be a JSON object")
        return data

    def _parse_model_output(
        self,
        data: Dict[str, Any],
        vw: int,
        vh: int,
        dom_elements: List[Dict] = None,
    ) -> Dict[str, Any]:
        """Parse the required model output JSON protocol."""
        schema_version = data.get("schema_version")
        if schema_version != MODEL_OUTPUT_SCHEMA_VERSION:
            raise ValueError(
                f"schema_version must be {MODEL_OUTPUT_SCHEMA_VERSION}, got {schema_version!r}"
            )

        actions_data = data.get("actions")
        if not isinstance(actions_data, list) or not actions_data:
            raise ValueError("actions must be a non-empty array")

        actions = self._normalize_actions(actions_data, vw, vh, dom_elements)
        if not actions:
            raise ValueError("no valid actions found")

        thought_payload = self._normalize_thought(data.get("thought"))
        status = data.get("status") if isinstance(data.get("status"), dict) else {}
        observation = data.get("observation") if isinstance(data.get("observation"), dict) else {}
        summaries = [
            self._format_summary(action["action_type"], action["action_inputs"])
            for action in actions
        ]
        final_answer = data.get("final_answer") or self._extract_finish_answer(actions)

        return {
            "thought": thought_payload["stream"],
            "thought_payload": thought_payload,
            "status": {
                "state": status.get("state", "running"),
                "is_task_complete": bool(status.get("is_task_complete", False)),
                "needs_user_input": bool(status.get("needs_user_input", False)),
                "error": status.get("error"),
            },
            "observation": observation,
            "actions": actions,
            "action_summary": " → ".join(summaries),
            "final_answer": final_answer,
            "schema_version": schema_version,
        }

    def _normalize_actions(
        self,
        actions_data: List[Dict[str, Any]],
        vw: int,
        vh: int,
        dom_elements: List[Dict] = None,
    ) -> List[Dict[str, Any]]:
        """Validate and normalize action objects into executor actions."""
        actions = []
        for item in actions_data:
            if not isinstance(item, dict):
                raise ValueError("each action must be an object")

            name = str(item.get("action_type") or "").lower()
            self._validate_action_name(name)
            inputs = item.get("action_inputs")
            if inputs is None:
                inputs = {}
            if not isinstance(inputs, dict):
                raise ValueError(f"action_inputs for {name} must be an object")
            self._validate_required_inputs(name, inputs)

            normalized = self._normalize_action_inputs(name, inputs, vw, vh, dom_elements)
            if normalized:
                actions.append(normalized)
        return actions

    @staticmethod
    def _validate_action_name(name: str) -> None:
        if not name:
            raise ValueError("action_type is required")
        if not is_supported_action(name):
            raise ValueError(f"unsupported action_type: {name}")

    @staticmethod
    def _validate_required_inputs(name: str, inputs: Dict[str, Any]) -> None:
        missing = [key for key in get_action_required_inputs(name) if key not in inputs]
        if missing:
            raise ValueError(f"missing required input(s) for {name}: {', '.join(missing)}")

    def _normalize_action_inputs(
        self,
        name: str,
        inputs: Dict[str, Any],
        vw: int,
        vh: int,
        dom_elements: List[Dict] = None,
    ) -> Optional[Dict[str, Any]]:
        """Normalize inputs, enrich DOM actions, and convert visual coordinates."""
        args = dict(inputs)
        group = get_action_group(name)

        if group == "dom":
            try:
                args["index"] = int(args["index"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError(f"index for {name} must be an integer") from exc
            args = self._enrich_dom_args(args, dom_elements)
            args["_mode"] = "dom"
        else:
            for key, value in list(args.items()):
                if "box" in key or "point" in key:
                    coords = self._normalize_to_pixels(str(value), vw, vh)
                    if not coords:
                        raise ValueError(f"{key} for {name} must contain valid coordinates")
                    args[f"{key}_coords"] = coords
            args["_mode"] = "visual"

        if name in ("dom_type", "type"):
            content = str(args.get("content", ""))
            if content.strip() == "":
                raise ValueError(f"content for {name} cannot be empty")

        return {"action_type": name, "action_inputs": args}

    def _invalid_result(self, error: str) -> Dict[str, Any]:
        """Return a safe parser result for invalid model output."""
        return {
            "thought": "",
            "thought_payload": {"stream": "", "summary": ""},
            "status": {
                "state": "failed",
                "is_task_complete": False,
                "needs_user_input": False,
                "error": error,
            },
            "observation": {},
            "actions": [{"action_type": "unknown", "action_inputs": {}}],
            "action_summary": "unknown",
            "final_answer": None,
            "schema_version": INVALID_MODEL_OUTPUT_SCHEMA_VERSION,
        }

    def _normalize_thought(self, thought: Any) -> Dict[str, str]:
        if isinstance(thought, dict):
            stream = str(thought.get("stream") or thought.get("text") or thought.get("summary") or "")
            summary = str(thought.get("summary") or self._summarize_text(stream))
            return {"stream": stream, "summary": summary}
        if isinstance(thought, str):
            return {"stream": thought, "summary": self._summarize_text(thought)}
        return {"stream": "", "summary": ""}

    @staticmethod
    def _extract_finish_answer(actions: List[Dict[str, Any]]) -> Optional[str]:
        for action in actions:
            action_type = str(action.get("action_type", "")).lower()
            if action_type not in ("finish", "finished"):
                continue
            inputs = action.get("action_inputs") or {}
            answer = inputs.get("answer")
            if isinstance(answer, str) and answer.strip():
                return answer
        return None

    @staticmethod
    def _summarize_text(text: str, limit: int = 160) -> str:
        text = (text or "").strip().replace("\n", " ")
        return text if len(text) <= limit else text[: limit - 3] + "..."

    def _enrich_dom_args(self, args: Dict[str, Any], dom_elements: List[Dict] = None) -> Dict[str, Any]:
        if dom_elements and "index" in args:
            idx = args["index"]
            max_valid_index = len(dom_elements) - 1
            if isinstance(idx, int) and 0 <= idx <= max_valid_index:
                elem = dom_elements[idx]
                args["selector"] = elem.get("selector", "")
                args["tag"] = elem.get("tag", "")
                args["text"] = elem.get("text", "")
                rect = elem.get("rect", {})
                if rect:
                    args["element_center"] = (
                        rect.get("x", 0) + rect.get("width", 0) / 2,
                        rect.get("y", 0) + rect.get("height", 0) / 2,
                    )
            elif isinstance(idx, int):
                print(f"[ActionParser] ❌ Index out of range: index={idx}, valid range=[0, {max_valid_index}]")
                args["_index_out_of_range"] = True
                args["_max_valid_index"] = max_valid_index
        return args

    def _normalize_to_pixels(
        self,
        coord_str: str,
        vw: int,
        vh: int,
    ) -> Optional[Tuple[float, float]]:
        """Convert normalized coordinates into viewport pixels."""
        raw = coord_str.strip()
        bracket_pairs = {"(": ")", "[": "]"}
        if raw[:1] in bracket_pairs:
            if not raw.endswith(bracket_pairs[raw[0]]):
                return None
            raw = raw[1:-1].strip()
        elif raw[-1:] in bracket_pairs.values():
            return None

        if not re.fullmatch(r"\d+\s*,\s*\d+(?:\s*,\s*\d+\s*,\s*\d+)?", raw):
            return None

        nums = [int(value.strip()) for value in raw.split(",")]
        if any(value < 0 or value > self.scale for value in nums):
            return None

        rel = [n / self.scale for n in nums]
        if len(rel) == 2:
            return (rel[0] * vw, rel[1] * vh)
        if len(rel) == 4:
            cx = (rel[0] + rel[2]) / 2
            cy = (rel[1] + rel[3]) / 2
            return (cx * vw, cy * vh)
        return None

    def _format_summary(self, func_name: str, args: Dict[str, Any]) -> str:
        """Format a compact action summary for logs."""
        name = func_name.lower()

        if name == "dom_click":
            idx = args.get("index", "?")
            text = args.get("text", "")[:15]
            return f"dom_click([{idx}] {text})" if text else f"dom_click([{idx}])"

        if name == "dom_type":
            idx = args.get("index", "?")
            content = args.get("content", "")[:20]
            return f"dom_type([{idx}]) -> '{content}'"

        if name == "dom_select":
            idx = args.get("index", "?")
            value = args.get("value", "")[:15]
            return f"dom_select([{idx}]) -> '{value}'"

        if name == "dom_hover":
            idx = args.get("index", "?")
            text = args.get("text", "")[:15]
            return f"dom_hover([{idx}] {text})" if text else f"dom_hover([{idx}])"

        if name in ["click", "type", "hover"]:
            coords = args.get("start_box_coords")
            if coords and isinstance(coords, (tuple, list)) and len(coords) >= 2:
                coords_str = f"({coords[0]:.1f}, {coords[1]:.1f})"
            else:
                coords_str = args.get("start_box", "?")

            content = args.get("content", "")
            if content:
                return f"{func_name}({coords_str}) -> '{content[:20]}'"
            return f"{func_name}({coords_str})"

        if name == "goto":
            return f"goto({args.get('url', '?')})"

        if name == "scroll":
            direction = args.get("direction", "down")
            amount = args.get("amount", "")
            if amount:
                return f"scroll({direction}, {amount})"
            return f"scroll({direction})"

        if name == "extract_page_text":
            return "extract_page_text()"

        return func_name
