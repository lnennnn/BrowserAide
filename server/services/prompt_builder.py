"""Build text and multimodal prompts for the VLM."""

import json
from typing import List, Dict
from core.config import Config
from core.types import BrowserControlMode
from core.protocol import (
    AGENT_CONTEXT_SCHEMA_VERSION,
    MODEL_OUTPUT_SCHEMA_VERSION,
    build_action_schemas,
)
from prompts import get_system_prompt, normalize_language


class PromptBuilder:
    """Build VLM inputs for DOM, visual, and hybrid control modes."""

    @staticmethod
    def build_text_prompt(
        instruction: str,
        history: str = "",
        history_steps: List[Dict] = None,
        memory_warnings: List[str] = None,
        runtime_context: Dict = None,
        browser_context: Dict = None,
        scroll_info: Dict = None,
        dom_elements: List[Dict] = None,
        mode: BrowserControlMode = BrowserControlMode.HYBRID,
        image_stats: Dict = None,
        extracted_text: str = None,
        extracted_text_summary: Dict = None,
        language: str = "en",
    ) -> str:
        """Build the text prompt for all control modes."""
        language = normalize_language(language)
        system_prompt = get_system_prompt(mode, language)
        payload = PromptBuilder._build_state_payload(
            instruction=instruction,
            history=history,
            history_steps=history_steps or [],
            memory_warnings=memory_warnings or [],
            runtime_context=runtime_context or {},
            browser_context=browser_context or {},
            scroll_info=scroll_info,
            dom_elements=dom_elements if mode != BrowserControlMode.VISUAL else None,
            mode=mode,
            image_stats=image_stats,
            extracted_text=extracted_text,
            extracted_text_summary=extracted_text_summary,
            language=language,
        )

        return (
            f"{system_prompt}\n"
            f"{PromptBuilder._build_language_instruction(language)}\n"
            "Read the JSON payload below. Decide the next browser action.\n"
            "Use only the provided action schema. Return exactly one JSON object "
            "matching output_contract. Do not return markdown.\n\n"
            "JSON_PAYLOAD:\n"
            f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
        )

    @staticmethod
    def _build_state_payload(
        instruction: str,
        history: str,
        history_steps: List[Dict],
        memory_warnings: List[str],
        runtime_context: Dict,
        browser_context: Dict,
        scroll_info: Dict,
        dom_elements: List[Dict],
        mode: BrowserControlMode,
        image_stats: Dict,
        extracted_text: str,
        extracted_text_summary: Dict,
        language: str,
    ) -> Dict:
        """Build the machine-readable agent state shown to the VLM."""
        return {
            "schema_version": AGENT_CONTEXT_SCHEMA_VERSION,
            "task": {
                "instruction": instruction,
                "locale": "zh-CN" if language == "zh" else "en-US",
                "response_language": language,
            },
            "runtime": runtime_context or {},
            "observation": {
                "agent": {
                    "name": "BrowserAide",
                    "mode": mode.value,
                    "coordinate_system": "normalized_0_1000",
                    "language": language,
                },
                "browser": {
                    **(browser_context or {}),
                    "scroll": PromptBuilder._format_scroll_state(scroll_info),
                },
                "screenshots": PromptBuilder._format_screenshot_state(image_stats),
                "page": {
                    "interactive_elements": PromptBuilder._format_dom_elements_json(dom_elements or []),
                    "extracted_text": extracted_text or None,
                    "extracted_text_summary": extracted_text_summary or None,
                },
            },
            "history": {
                "steps": history_steps,
                "warnings": memory_warnings,
            },
            "actions": {
                "available": build_action_schemas(mode, language),
            },
            "output_contract": PromptBuilder._build_output_contract(language),
        }


    @staticmethod
    def _build_language_instruction(language: str) -> str:
        if normalize_language(language) == "zh":
            return "Language requirement: use Chinese for thought, observation, user-facing reasons, and final answers unless the user explicitly asks otherwise."
        return "Language requirement: use English for thought, observation, user-facing reasons, and final answers unless the user explicitly asks otherwise."

    @staticmethod
    def _format_scroll_state(scroll_info: Dict = None) -> Dict:
        if not scroll_info:
            return {
                "x": 0,
                "y": 0,
                "total_height": 0,
                "viewport_height": 0,
                "vertical_progress": 0,
                "can_scroll_down": False,
                "can_scroll_up": False,
            }

        y = scroll_info.get("y", 0)
        total = scroll_info.get("total", 0)
        viewport = scroll_info.get("viewport", 0)
        progress = min(100, int((y + viewport) / max(total, 1) * 100)) if viewport else 0

        return {
            "x": scroll_info.get("x", 0),
            "y": y,
            "total_height": total,
            "viewport_height": viewport,
            "vertical_progress": progress,
            "can_scroll_down": bool(total > viewport and (y + viewport) < total),
            "can_scroll_up": bool(y > 0),
            "total_width": scroll_info.get("totalWidth", 0),
            "viewport_width": scroll_info.get("viewportWidth", 0),
        }

    @staticmethod
    def _format_screenshot_state(image_stats: Dict = None) -> Dict:
        image_stats = image_stats or {"total": 0, "kept": 0, "omitted": 0}
        kept = image_stats.get("kept", 0)
        return {
            "attached_count": kept,
            "current_image_index": kept,
            "omitted_count": image_stats.get("omitted", 0),
            "note": "DOM indices and visual coordinates refer to the latest screenshot only.",
        }

    @staticmethod
    def _format_dom_elements_json(elements: List[Dict]) -> List[Dict]:
        formatted = []
        for elem in (elements or [])[:Config.MAX_DOM_ELEMENTS]:
            formatted.append({
                "index": elem.get("index", 0),
                "tag": elem.get("tag", ""),
                "text": (elem.get("text") or "")[:80],
                "role": elem.get("role", ""),
                "type": elem.get("type", ""),
                "name": elem.get("name", ""),
                "placeholder": elem.get("placeholder", ""),
                "value": elem.get("value", ""),
                "context": (elem.get("context") or "")[:120],
                "rect": elem.get("rect", {}),
            })
        return formatted

    @staticmethod
    def _build_output_contract(language: str = "en") -> Dict:
        if normalize_language(language) == "zh":
            return {
                "schema_version": MODEL_OUTPUT_SCHEMA_VERSION,
                "required_fields": ["schema_version", "thought", "status", "actions"],
                "thought": {
                    "stream": "简短实时推理，只说明下一步意图；不要包含最终答案或长篇总结。",
                    "summary": "适合记忆的简短推理摘要。",
                },
                "status": {
                    "state": "running|completed|waiting_for_user|failed",
                    "is_task_complete": "boolean",
                    "needs_user_input": "boolean",
                    "error": "string|null",
                },
                "actions": [
                    {
                        "action_type": "actions.available.action_type 中的一种",
                        "action_inputs": "符合所选 action input_schema 的对象",
                        "rationale": "可选；如提供，只写很短的原因，不要重复 thought 或 answer",
                    }
                ],
                "finish_rule": "如果 action_type 是 finish，完整最终答案只放在 action_inputs.answer。",
            }
        return {
            "schema_version": MODEL_OUTPUT_SCHEMA_VERSION,
            "required_fields": ["schema_version", "thought", "status", "actions"],
            "thought": {
                "stream": "Brief live reasoning that states the next intent only; do not include final answers or long summaries.",
                "summary": "Short memory-friendly summary of the reasoning.",
            },
            "status": {
                "state": "running|completed|waiting_for_user|failed",
                "is_task_complete": "boolean",
                "needs_user_input": "boolean",
                "error": "string|null",
            },
            "actions": [
                {
                    "action_type": "one of actions.available.action_type",
                    "action_inputs": "object matching the selected action input_schema",
                    "rationale": "optional; if present, keep it very short and do not repeat thought or answer",
                }
            ],
            "finish_rule": "When action_type is finish, put the complete final answer only in action_inputs.answer.",
        }
    @staticmethod
    def build_multimodal_messages(
        text_prompt: str,
        images: List[str],
        max_images: int = None
    ) -> List[Dict]:
        """Build OpenAI-compatible multimodal messages with an image window."""
        max_images = max_images or Config.MAX_IMAGE_HISTORY

        total_images = len(images)
        images_to_keep = images[-max_images:] if total_images > max_images else images
        omitted_count = max(0, total_images - max_images)

        if omitted_count > 0:
            text_prompt = (
                f"{text_prompt}\n\n"
                f"[Context: Showing {len(images_to_keep)} most recent screenshots. "
                f"{omitted_count} earlier screenshots omitted to conserve context.]"
            )

        content = [{"type": "text", "text": text_prompt}]

        for img_b64 in images_to_keep:
            if img_b64.startswith("data:image"):
                url = img_b64
            else:
                url = f"data:image/jpeg;base64,{img_b64}"

            content.append({
                "type": "image_url",
                "image_url": {"url": url}
            })

        return [{"role": "user", "content": content}]
