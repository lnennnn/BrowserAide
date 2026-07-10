import json
import os
import sys
import unittest

SERVER_DIR = os.path.dirname(os.path.dirname(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from core.protocol import (  # noqa: E402
    AGENT_CONTEXT_SCHEMA_VERSION,
    MODEL_OUTPUT_SCHEMA_VERSION,
    STEP_REQUEST_SCHEMA_VERSION,
    build_action_schemas,
    get_supported_actions,
    is_supported_action,
)
from core.types import BrowserControlMode  # noqa: E402
from services.action_parser import ActionParser  # noqa: E402
from services.prompt_builder import PromptBuilder  # noqa: E402
from services.stream_extractors import (  # noqa: E402
    extract_partial_finish_answer,
    extract_partial_thought_stream,
)


class ProtocolTest(unittest.TestCase):
    def test_action_schema_uses_shared_supported_actions(self):
        self.assertEqual(STEP_REQUEST_SCHEMA_VERSION, "agent.step.request.v1")
        schemas = build_action_schemas(BrowserControlMode.HYBRID, "en")
        schema_names = {schema["action_type"] for schema in schemas}
        self.assertIn("dom_click", schema_names)
        self.assertIn("click", schema_names)
        self.assertIn("finish", schema_names)
        self.assertTrue(schema_names.issubset(get_supported_actions()))
        self.assertTrue(is_supported_action("dom_type"))
        self.assertFalse(is_supported_action("missing_action"))

    def test_prompt_context_shape_and_visual_dom_filter(self):
        dom_elements = [{
            "index": 0,
            "tag": "button",
            "text": "Submit",
            "context": "form action",
            "rect": {"x": 1, "y": 2, "width": 3, "height": 4},
        }]
        prompt = PromptBuilder.build_text_prompt(
            instruction="submit the form",
            history_steps=[{"step": 1, "action_summary": "wait"}],
            memory_warnings=["screen unchanged"],
            runtime_context={"step_index": 2},
            browser_context={"url": "https://example.com", "title": "Example"},
            scroll_info={"y": 0, "total": 1000, "viewport": 200},
            dom_elements=dom_elements,
            mode=BrowserControlMode.HYBRID,
            image_stats={"total": 1, "kept": 1, "omitted": 0},
        )
        payload = json.loads(prompt.split("JSON_PAYLOAD:\n", 1)[1])
        self.assertEqual(payload["schema_version"], AGENT_CONTEXT_SCHEMA_VERSION)
        self.assertEqual(payload["observation"]["page"]["interactive_elements"][0]["text"], "Submit")
        self.assertIn("available", payload["actions"])
        self.assertNotIn("rendered_legacy_history", json.dumps(payload))

        visual_prompt = PromptBuilder.build_text_prompt(
            instruction="click visible button",
            dom_elements=dom_elements,
            mode=BrowserControlMode.VISUAL,
            image_stats={"total": 1, "kept": 1, "omitted": 0},
        )
        visual_payload = json.loads(visual_prompt.split("JSON_PAYLOAD:\n", 1)[1])
        self.assertEqual(visual_payload["observation"]["page"]["interactive_elements"], [])

    def test_action_parser_strict_json_path(self):
        parser = ActionParser()
        dom_elements = [{
            "selector": "#q",
            "tag": "input",
            "text": "Search",
            "rect": {"x": 10, "y": 20, "width": 100, "height": 20},
        }]
        parsed = parser.parse(json.dumps({
            "schema_version": MODEL_OUTPUT_SCHEMA_VERSION,
            "thought": {"stream": "type", "summary": "type"},
            "status": {"state": "running"},
            "actions": [{"action_type": "dom_type", "action_inputs": {"index": "0", "content": "abc"}}],
        }), 1000, 800, dom_elements)
        self.assertEqual(parsed["actions"][0]["action_inputs"]["selector"], "#q")
        self.assertEqual(parsed["actions"][0]["action_inputs"]["element_center"], (60.0, 30.0))

        parsed = parser.parse(json.dumps({
            "schema_version": MODEL_OUTPUT_SCHEMA_VERSION,
            "thought": {"stream": "click", "summary": "click"},
            "status": {"state": "running"},
            "actions": [{"action_type": "click", "action_inputs": {"start_box": "(500,250)"}}],
        }), 1000, 800)
        self.assertEqual(parsed["actions"][0]["action_inputs"]["start_box_coords"], (500.0, 200.0))

    def test_action_parser_rejects_bad_actions(self):
        parser = ActionParser()
        parsed = parser.parse(json.dumps({
            "schema_version": MODEL_OUTPUT_SCHEMA_VERSION,
            "actions": [{"action_type": "type", "action_inputs": {"start_box": "(1,1)", "content": "   "}}],
        }), 100, 100)
        self.assertEqual(parsed["schema_version"], "invalid_model_output")
        self.assertEqual(parsed["status"]["state"], "failed")
        self.assertEqual(parsed["actions"][0]["action_type"], "unknown")

        parsed = parser.parse(json.dumps({
            "schema_version": MODEL_OUTPUT_SCHEMA_VERSION,
            "actions": [{"action_type": "made_up", "action_inputs": {}}],
        }), 100, 100)
        self.assertEqual(parsed["schema_version"], "invalid_model_output")
        self.assertEqual(parsed["actions"][0]["action_type"], "unknown")

        parsed = parser.parse("Thought: no longer accepted\nAction: click(start_box='(500,250)')", 1000, 800)
        self.assertEqual(parsed["schema_version"], "invalid_model_output")
        self.assertIn("not valid JSON", parsed["status"]["error"])

        parsed = parser.parse("```json\n{}\n```", 1000, 800)
        self.assertEqual(parsed["schema_version"], "invalid_model_output")
        self.assertIn("markdown fenced output", parsed["status"]["error"])

    def test_stream_extractors_tolerate_partial_json(self):
        self.assertEqual(extract_partial_thought_stream('{"thought":{"stream":"hello'), "hello")
        self.assertEqual(extract_partial_thought_stream('{"thought":{"stream":"hello\\nworld"'), "hello\nworld")
        self.assertEqual(
            extract_partial_finish_answer('{"actions":[{"action_type":"finish","action_inputs":{"answer":"done'),
            "done",
        )
        self.assertEqual(extract_partial_finish_answer('{bad'), "")


if __name__ == "__main__":
    unittest.main()
