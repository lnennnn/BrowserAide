"""Prompt package exports."""

from .base import SYSTEM_PROMPT_BASE, SYSTEM_PROMPT_BASE_EN, SYSTEM_PROMPT_BASE_ZH
from .visual import SYSTEM_PROMPT_VISUAL, SYSTEM_PROMPT_VISUAL_ZH
from .dom import SYSTEM_PROMPT_DOM, SYSTEM_PROMPT_DOM_ZH
from .hybrid import SYSTEM_PROMPT_HYBRID, SYSTEM_PROMPT_HYBRID_ZH
from .selector import get_system_prompt, normalize_language

__all__ = [
    "SYSTEM_PROMPT_BASE",
    "SYSTEM_PROMPT_BASE_EN",
    "SYSTEM_PROMPT_BASE_ZH",
    "SYSTEM_PROMPT_VISUAL",
    "SYSTEM_PROMPT_VISUAL_ZH",
    "SYSTEM_PROMPT_DOM",
    "SYSTEM_PROMPT_DOM_ZH",
    "SYSTEM_PROMPT_HYBRID",
    "SYSTEM_PROMPT_HYBRID_ZH",
    "get_system_prompt",
    "normalize_language",
]
