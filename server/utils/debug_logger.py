"""Debug logging helpers for VLM inputs and outputs."""

import base64
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict
from core.config import Config

MAX_SESSIONS = 5


class DebugLogger:
    """Persists debug inputs and outputs for each VLM step."""

    def __init__(self, output_dir: str = None):
        self.output_dir = output_dir or Config.DEBUG_OUTPUT_DIR
        self.session_dir: Optional[Path] = None
        self.step_count = 0
        self.enabled = Config.DEBUG_SAVE_INPUTS

    def start_session(self) -> Optional[Path]:
        """Start session."""
        if not self.enabled:
            return None

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.session_dir = Path(self.output_dir) / f"session_{timestamp}"
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.step_count = 0

        self._cleanup_old_sessions()

        print(f"[Debug] Session started: {self.session_dir}")
        return self.session_dir

    def _cleanup_old_sessions(self) -> None:
        """Cleanup old sessions."""
        output = Path(self.output_dir)
        if not output.exists():
            return

        sessions = sorted(
            [d for d in output.iterdir() if d.is_dir() and d.name.startswith("session_")],
            key=lambda d: d.name
        )

        while len(sessions) > MAX_SESSIONS:
            oldest = sessions.pop(0)
            try:
                shutil.rmtree(oldest)
                print(f"[Debug] Removed old session: {oldest.name}")
            except Exception as e:
                print(f"[Debug] Failed to remove {oldest.name}: {e}")

    def save_step(
        self,
        text_prompt: str,
        images: List[str],
        instruction: str,
        viewport: Dict[str, int],
        extra_metadata: Dict = None
    ) -> Optional[Path]:
        """Save step."""
        if not self.enabled:
            return None

        if not self.session_dir:
            self.start_session()

        self.step_count += 1
        step_dir = self.session_dir / f"step_{self.step_count:03d}"

        try:
            step_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            print(f"[Debug] Failed to create step dir: {e}")
            return None

        prompt_file = step_dir / "prompt.txt"
        prompt_file.write_text(text_prompt, encoding="utf-8")

        metadata = {
            "step": self.step_count,
            "timestamp": datetime.now().isoformat(),
            "instruction": instruction,
            "viewport": viewport,
            "image_count": len(images),
            "model": Config.VLM_MODEL,
            **(extra_metadata or {})
        }
        metadata_file = step_dir / "metadata.json"
        metadata_file.write_text(
            json.dumps(metadata, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )

        for i, img_base64 in enumerate(images):
            try:
                img_data = base64.b64decode(img_base64)
                img_file = step_dir / f"image_{i}.png"
                img_file.write_bytes(img_data)
            except Exception as e:
                print(f"[Debug] Failed to save image {i}: {e}")

        print(f"[Debug] Saved step {self.step_count} to {step_dir}")
        return step_dir

    def save_output(self, vlm_output: str) -> bool:
        """Save output."""
        if not self.enabled or not self.session_dir:
            return False

        step_dir = self.session_dir / f"step_{self.step_count:03d}"

        try:
            step_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            print(f"[Debug] Failed to create step dir: {e}")
            return False

        output_file = step_dir / "vlm_output.txt"
        output_file.write_text(vlm_output, encoding="utf-8")
        return True

    def reset(self) -> Optional[Path]:
        """Reset."""
        return self.start_session()

    def disable(self) -> None:
        self.enabled = False

    def enable(self) -> None:
        self.enabled = True



debug_logger = DebugLogger()
