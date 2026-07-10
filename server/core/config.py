"""Global configuration values."""

import os


try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


class Config:
    """Global configuration values loaded from environment variables."""



    VLM_API_KEY: str = os.getenv("VLM_API_KEY", "")
    VLM_BASE_URL: str = os.getenv("VLM_BASE_URL", "")
    VLM_MODEL: str = os.getenv("VLM_MODEL_NAME", "")
    VLM_MAX_TOKENS: int = int(os.getenv("VLM_MAX_TOKENS", "8000"))
    VLM_DEFAULT_STEP_MAX_TOKENS: int = int(os.getenv("VLM_DEFAULT_STEP_MAX_TOKENS", "3000"))
    VLM_SUMMARY_STEP_MAX_TOKENS: int = int(os.getenv("VLM_SUMMARY_STEP_MAX_TOKENS", "8000"))
    VLM_LARGE_EXTRACT_THRESHOLD_CHARS: int = int(os.getenv("VLM_LARGE_EXTRACT_THRESHOLD_CHARS", "6000"))
    VLM_MAX_CONCURRENT: int = int(os.getenv("VLM_MAX_CONCURRENT", "1"))
    VLM_MIN_REQUEST_INTERVAL_MS: int = int(os.getenv("VLM_MIN_REQUEST_INTERVAL_MS", "1200"))
    VLM_BURST_RETRY_ATTEMPTS: int = int(os.getenv("VLM_BURST_RETRY_ATTEMPTS", "4"))
    VLM_BURST_RETRY_BASE_MS: int = int(os.getenv("VLM_BURST_RETRY_BASE_MS", "2500"))




    BROWSER_CONTROL_MODE: str = os.getenv("BROWSER_CONTROL_MODE", "hybrid")




    MAX_IMAGE_HISTORY: int = int(os.getenv("MAX_IMAGE_HISTORY", "3"))
    IMAGE_PLACEHOLDER: str = "[Image omitted to conserve context]"


    MAX_CONTEXT_TOKENS: int = int(os.getenv("MAX_CONTEXT_TOKENS", "128000"))
    CHARS_PER_TOKEN: int = 3
    IMAGE_TOKENS: int = 800


    MAX_CONVERSATION_HISTORY: int = 20
    MAX_HISTORY_DISPLAY: int = 12



    COORDINATE_SCALE: int = 1000
    MAX_DOM_ELEMENTS: int = 80



    ACTION_STACK_SIZE: int = 15
    LOOP_DETECT_THRESHOLD: int = 3


    PATTERN_LOOP_MIN_LENGTH: int = 2
    PATTERN_LOOP_REPETITIONS: int = 2


    MAX_CONSECUTIVE_FAILURES: int = 3
    MAX_SAME_ACTION_FAILURES: int = 5


    SCREEN_SIMILARITY_THRESHOLD: float = 0.95
    NO_CHANGE_MAX_COUNT: int = 3



    DEBUG_SAVE_INPUTS: bool = os.getenv("DEBUG_SAVE_INPUTS", "true").lower() == "true"
    DEBUG_OUTPUT_DIR: str = os.getenv("DEBUG_OUTPUT_DIR", "debug_logs")



    SERVER_HOST: str = os.getenv("SERVER_HOST", "127.0.0.1")
    SERVER_PORT: int = int(os.getenv("SERVER_PORT", "8004"))



config = Config()
