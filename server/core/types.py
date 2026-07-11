"""Pydantic models and enums."""

from enum import Enum
from typing import Optional, List, Dict, Any, Tuple
from pydantic import BaseModel




class BrowserControlMode(str, Enum):
    """Browser control mode."""
    DOM = "dom"
    VISUAL = "visual"
    HYBRID = "hybrid"


class PromptLanguage(str, Enum):
    """Prompt and answer language."""
    EN = "en"
    ZH = "zh"


class ActionMode(str, Enum):
    """Action execution mode."""
    DOM = "dom"
    VISUAL = "visual"




class DOMElement(BaseModel):
    """DOM element metadata."""
    index: int
    tag: str
    text: str = ""
    role: str = ""
    type: str = ""
    name: str = ""
    id: str = ""
    className: str = ""
    placeholder: str = ""
    value: str = ""
    href: str = ""
    selector: str
    rect: Dict[str, float] = {}


class ScrollInfo(BaseModel):
    """Scroll position metadata."""
    y: float = 0
    total: float = 0      # scrollHeight
    viewport: float = 0   # innerHeight


class StepRequest(BaseModel):
    """Step request payload from the Chrome extension."""
    schema_version: str = "agent.step.request.v1"
    instruction: str
    screenshot: str
    scroll_info: Optional[ScrollInfo] = None
    width: int = 1280
    height: int = 720
    dom_elements: Optional[List[Dict]] = None
    control_mode: Optional[str] = None
    extracted_text: Optional[str] = None
    session_id: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = None
    last_action_result: Optional[Dict[str, Any]] = None
    max_consecutive_failures: Optional[int] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None


class ActionResult(BaseModel):
    """Parsed action payload."""
    action_type: str
    action_inputs: Dict[str, Any] = {}


class StepResponse(BaseModel):
    """Step response payload returned to the Chrome extension."""
    thought: str
    thought_payload: Optional[Dict[str, Any]] = None
    actions: List[Dict[str, Any]]
    action_summary: str
    should_stop: bool
    final_answer: Optional[str] = None
    control_mode: str = "hybrid"
    schema_version: str = "agent.step.response.v1"
    status: Optional[Dict[str, Any]] = None
    observation: Optional[Dict[str, Any]] = None
    runtime: Optional[Dict[str, Any]] = None
    metrics: Optional[Dict[str, float]] = None


class ModeChangeRequest(BaseModel):
    """Mode change request payload."""
    mode: str  # "dom" | "visual" | "hybrid"


class ResetRequest(BaseModel):
    """Reset request payload."""
    session_id: Optional[str] = None


class VLMTestRequest(BaseModel):
    """VLM endpoint test request payload."""
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None


class HealthResponse(BaseModel):
    """Health response payload."""
    status: str
    version: str
    model: str
    control_mode: str
    memory: Dict[str, int]




class ParsedAction(BaseModel):
    """Parsed action result."""
    thought: str
    actions: List[Dict[str, Any]]
    action_summary: str


class Coordinates(BaseModel):
    """2D coordinates."""
    x: float
    y: float

    def to_tuple(self) -> Tuple[float, float]:
        return (self.x, self.y)
