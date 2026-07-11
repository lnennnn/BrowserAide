import os
import sys
import unittest

os.environ.setdefault("VLM_API_KEY", "dummy")
SERVER_DIR = os.path.dirname(os.path.dirname(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from core.types import StepRequest  # noqa: E402
from main import (  # noqa: E402
    _build_response_status,
    _resolve_prompt_language,
    _resolve_step_outcome,
)


class StepOutcomeTest(unittest.TestCase):
    def test_finish_completes(self):
        parsed = {
            "thought": "done",
            "actions": [{"action_type": "finish", "action_inputs": {"answer": "ok"}}],
            "status": {"state": "running"},
        }
        outcome = _resolve_step_outcome(parsed)
        self.assertTrue(outcome["should_stop"])
        self.assertEqual(outcome["final_answer"], "ok")
        self.assertEqual(_build_response_status(parsed, True)["state"], "completed")

    def test_waiting_for_user_does_not_complete(self):
        parsed = {
            "thought": "needs login",
            "actions": [{"action_type": "call_user", "action_inputs": {"reason": "login"}}],
            "status": {"state": "waiting_for_user", "needs_user_input": True},
        }
        outcome = _resolve_step_outcome(parsed)
        self.assertFalse(outcome["should_stop"])
        status = _build_response_status(parsed, False)
        self.assertEqual(status["state"], "waiting_for_user")
        self.assertTrue(status["needs_user_input"])

    def test_prompt_language_uses_instruction_detection(self):
        request = StepRequest(instruction="完成这个任务", screenshot="")
        self.assertEqual(_resolve_prompt_language(request), "zh")


if __name__ == "__main__":
    unittest.main()
