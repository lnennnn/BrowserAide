"""General helper functions."""

from typing import Tuple, Optional, List, Dict


def get_action_signature(action: Dict) -> str:
    """Get action signature."""
    action_type = action.get("action_type", "unknown").lower()
    inputs = action.get("action_inputs", {})


    if action_type.startswith("dom_"):
        idx = inputs.get("index", "?")
        return f"{action_type}@{idx}"


    if action_type in ["click", "type"]:
        coords = inputs.get("start_box_coords", "?")
        return f"{action_type}@{coords}"

    if action_type == "goto":
        return f"goto@{inputs.get('url', '?')}"

    return action_type


def check_task_completion(actions: List[Dict], thought: str) -> Tuple[bool, Optional[str]]:
    """Check task completion."""
    for action in actions:
        action_type = action.get("action_type", "").lower()
        if action_type in ["finish", "finished"]:
            answer = action.get("action_inputs", {}).get("answer", thought)
            return True, answer

    return False, None


def format_coordinates(coords: Tuple[float, float], precision: int = 1) -> str:
    """Format coordinates."""
    if not coords or len(coords) < 2:
        return "(?)"
    return f"({coords[0]:.{precision}f}, {coords[1]:.{precision}f})"


def truncate_text(text: str, max_length: int = 50, suffix: str = "...") -> str:
    """Truncate text."""
    if not text:
        return ""
    if len(text) <= max_length:
        return text
    return text[:max_length - len(suffix)] + suffix
