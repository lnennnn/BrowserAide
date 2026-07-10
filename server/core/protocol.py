"""Shared protocol constants and action schemas."""

from core.types import BrowserControlMode


def normalize_protocol_language(language: str = None) -> str:
    """Normalize protocol language to en or zh without importing prompt modules."""
    return "zh" if str(language or "").lower().startswith("zh") else "en"

STEP_REQUEST_SCHEMA_VERSION = "agent.step.request.v1"
AGENT_CONTEXT_SCHEMA_VERSION = "agent.context.v1"
MODEL_OUTPUT_SCHEMA_VERSION = "agent.step.output.v1"
STEP_RESPONSE_SCHEMA_VERSION = "agent.step.response.v1"

ACTION_GROUPS = {
    "dom_click": "dom",
    "dom_type": "dom",
    "dom_select": "dom",
    "dom_hover": "dom",
    "click": "visual",
    "type": "visual",
    "hover": "visual",
    "scroll": "common",
    "goto": "common",
    "back": "common",
    "wait": "common",
    "extract_page_text": "common",
    "extract_text": "common",
    "finish": "common",
    "finished": "common",
    "call_user": "common",
}

SUPPORTED_ACTIONS = frozenset(ACTION_GROUPS)

_ACTION_TEXT_EN = {
    "scroll": "Scroll the page.",
    "goto": "Navigate to a URL.",
    "back": "Go back to the previous page.",
    "wait": "Wait briefly for page loading.",
    "extract_page_text": "Extract readable text from the current page. On the next step, use observation.page.extracted_text to answer or act; do not scroll just to continue reading unless the extracted text is missing or explicitly insufficient.",
    "call_user": "Request human help for login, CAPTCHA, or sensitive confirmation.",
    "finish": "Complete the task with a final answer.",
    "dom_click": "Click an indexed DOM element.",
    "dom_type": "Focus/click an indexed editable element and type text into it, then press Enter. Use this directly for text fields; do not click first just to focus.",
    "dom_select": "Select an option in an indexed dropdown.",
    "dom_hover": "Hover over an indexed DOM element.",
    "click": "Click normalized visual coordinates on the latest screenshot.",
    "type": "Focus/click normalized visual coordinates and type text there, then press Enter. Use this directly for text fields; do not click first just to focus.",
    "hover": "Hover over normalized visual coordinates.",
}

_ACTION_TEXT_ZH = {
    "scroll": "滚动页面。",
    "goto": "跳转到指定 URL。",
    "back": "返回上一页。",
    "wait": "短暂等待页面加载。",
    "extract_page_text": "提取当前页面的可读文本。下一步使用 observation.page.extracted_text 回答或操作；除非文本缺失或明确不足，不要只是为了继续阅读而滚动。",
    "call_user": "请求用户处理登录、验证码或敏感确认。",
    "finish": "完成任务并给出最终答案。",
    "dom_click": "点击带索引的 DOM 元素。",
    "dom_type": "聚焦/点击带索引的可编辑元素并输入文本，然后按 Enter。文本框直接用它，不要先单独点击聚焦。",
    "dom_select": "在带索引的下拉框中选择选项。",
    "dom_hover": "悬停带索引的 DOM 元素。",
    "click": "点击最新截图上的归一化视觉坐标。",
    "type": "聚焦/点击归一化视觉坐标并输入文本，然后按 Enter。文本框直接用它，不要先单独点击聚焦。",
    "hover": "悬停归一化视觉坐标。",
}

_ACTION_INPUTS = {
    "scroll": ({
        "direction": {"type": "string", "enum": ["down", "up", "left", "right", "top", "bottom"]},
        "amount": {"type": "string", "enum": ["small", "medium", "large"]},
    }, ["direction"]),
    "goto": ({"url": {"type": "string"}}, ["url"]),
    "back": ({}, []),
    "wait": ({}, []),
    "extract_page_text": ({}, []),
    "call_user": ({"reason": {"type": "string"}}, ["reason"]),
    "finish": ({"answer": {"type": "string"}}, ["answer"]),
    "dom_click": ({"index": {"type": "integer"}}, ["index"]),
    "dom_type": ({"index": {"type": "integer"}, "content": {"type": "string"}}, ["index", "content"]),
    "dom_select": ({"index": {"type": "integer"}, "value": {"type": "string"}}, ["index", "value"]),
    "dom_hover": ({"index": {"type": "integer"}}, ["index"]),
    "click": ({"start_box": {"type": "string", "description": "(x,y) in 0-1000 coordinates"}}, ["start_box"]),
    "type": ({
        "start_box": {"type": "string", "description": "(x,y) in 0-1000 coordinates"},
        "content": {"type": "string"},
    }, ["start_box", "content"]),
    "hover": ({"start_box": {"type": "string", "description": "(x,y) in 0-1000 coordinates"}}, ["start_box"]),
}

_MODE_ACTIONS = {
    BrowserControlMode.DOM: [
        "dom_click", "dom_type", "dom_select", "dom_hover",
        "scroll", "goto", "back", "wait", "extract_page_text", "call_user", "finish",
    ],
    BrowserControlMode.VISUAL: [
        "click", "type", "hover",
        "scroll", "goto", "back", "wait", "extract_page_text", "call_user", "finish",
    ],
    BrowserControlMode.HYBRID: [
        "dom_click", "dom_type", "dom_select", "dom_hover",
        "click", "type", "hover",
        "scroll", "goto", "back", "wait", "extract_page_text", "call_user", "finish",
    ],
}


def get_supported_actions() -> set[str]:
    """Return every action accepted by the parser."""
    return set(SUPPORTED_ACTIONS)


def get_mode_action_names(mode: BrowserControlMode) -> list[str]:
    """Return model-facing actions for a control mode."""
    return list(_MODE_ACTIONS.get(mode, _MODE_ACTIONS[BrowserControlMode.HYBRID]))


def is_supported_action(action_type: str) -> bool:
    """Return whether an action name is part of the protocol."""
    return str(action_type or "").lower() in SUPPORTED_ACTIONS


def get_action_group(action_type: str) -> str | None:
    """Return dom, visual, or common for an action type."""
    return ACTION_GROUPS.get(str(action_type or "").lower())


def get_action_required_inputs(action_type: str) -> list[str]:
    """Return required input names for an action type."""
    spec = _ACTION_INPUTS.get(str(action_type or "").lower())
    return list(spec[1]) if spec else []


def get_action_input_properties(action_type: str) -> dict:
    """Return declared input properties for an action type."""
    spec = _ACTION_INPUTS.get(str(action_type or "").lower())
    return dict(spec[0]) if spec else {}


def build_action_schemas(mode: BrowserControlMode, language: str = "en") -> list[dict]:
    """Return action schemas for the active browser control mode."""
    descriptions = _ACTION_TEXT_ZH if normalize_protocol_language(language) == "zh" else _ACTION_TEXT_EN
    schemas = []
    for name in get_mode_action_names(mode):
        properties, required = _ACTION_INPUTS[name]
        schemas.append({
            "action_type": name,
            "description": descriptions[name],
            "input_schema": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        })
    return schemas
