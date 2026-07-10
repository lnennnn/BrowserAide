"""System prompt selector."""

from core.types import BrowserControlMode
from .visual import SYSTEM_PROMPT_VISUAL, SYSTEM_PROMPT_VISUAL_ZH
from .dom import SYSTEM_PROMPT_DOM, SYSTEM_PROMPT_DOM_ZH
from .hybrid import SYSTEM_PROMPT_HYBRID, SYSTEM_PROMPT_HYBRID_ZH


def normalize_language(language: str = None) -> str:
    """Normalize prompt language to en or zh."""
    return "zh" if str(language or "").lower().startswith("zh") else "en"


def get_system_prompt(mode: BrowserControlMode, language: str = "en") -> str:
    """Get system prompt for the requested mode and language."""
    if normalize_language(language) == "zh":
        prompts = {
            BrowserControlMode.VISUAL: SYSTEM_PROMPT_VISUAL_ZH,
            BrowserControlMode.DOM: SYSTEM_PROMPT_DOM_ZH,
            BrowserControlMode.HYBRID: SYSTEM_PROMPT_HYBRID_ZH,
        }
        return prompts.get(mode, SYSTEM_PROMPT_HYBRID_ZH)

    prompts = {
        BrowserControlMode.VISUAL: SYSTEM_PROMPT_VISUAL,
        BrowserControlMode.DOM: SYSTEM_PROMPT_DOM,
        BrowserControlMode.HYBRID: SYSTEM_PROMPT_HYBRID,
    }
    return prompts.get(mode, SYSTEM_PROMPT_HYBRID)
