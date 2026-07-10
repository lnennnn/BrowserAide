# BrowserAide Protocol Refactor

This repository contains the Chrome extension in `extention/` and the FastAPI backend in `server/`.

## Protocol Flow

```text
Chrome extension StepRequest
  -> server AgentContext prompt payload
  -> VLM ModelStepOutput JSON
  -> ActionParser normalized actions
  -> server StepResponse
  -> extension execution result for next step
```

## Schema Versions

The canonical constants live in `server/core/protocol.py`.

| Protocol | Version |
| --- | --- |
| Extension request | `agent.step.request.v1` |
| Model context | `agent.context.v1` |
| Model output | `agent.step.output.v1` |
| Server response | `agent.step.response.v1` |

## StepRequest

The extension builds this in `extention/background.js`.

```json
{
  "schema_version": "agent.step.request.v1",
  "instruction": "Search for BrowserAide",
  "screenshot": "base64-jpeg-without-data-url-prefix",
  "scroll_info": {"y": 0, "total": 1200, "viewport": 720},
  "width": 1280,
  "height": 720,
  "dom_elements": [],
  "control_mode": "hybrid",
  "extracted_text": null,
  "session_id": "ext_session_id",
  "url": "https://example.com",
  "title": "Example",
  "last_action_result": {"success": true, "error": null},
  "max_consecutive_failures": 3
}
```

## AgentContext

The server builds this in `server/services/prompt_builder.py` and sends it to the VLM with the recent screenshot window.

```json
{
  "schema_version": "agent.context.v1",
  "task": {
    "instruction": "Search for BrowserAide",
    "locale": "en-US",
    "response_language": "en"
  },
  "runtime": {
    "step_index": 1,
    "session_id": "ext_session_id"
  },
  "observation": {
    "agent": {
      "name": "BrowserAide",
      "mode": "hybrid",
      "coordinate_system": "normalized_0_1000",
      "language": "en"
    },
    "browser": {
      "url": "https://example.com",
      "title": "Example",
      "viewport": {"width": 1280, "height": 720},
      "scroll": {"y": 0, "can_scroll_down": true, "can_scroll_up": false}
    },
    "screenshots": {
      "attached_count": 1,
      "current_image_index": 1,
      "omitted_count": 0
    },
    "page": {
      "interactive_elements": [],
      "extracted_text": null,
      "extracted_text_summary": null
    }
  },
  "history": {
    "steps": [],
    "warnings": []
  },
  "actions": {
    "available": []
  },
  "output_contract": {}
}
```

## ModelStepOutput

The VLM should return exactly one JSON object matching `agent.step.output.v1`. Markdown fences, legacy `Thought:` / `Action:` text, single-action shorthand, and missing `schema_version` outputs are invalid. Invalid model output is converted to a safe `invalid_model_output` parser result and surfaced in `status.error`.

```json
{
  "schema_version": "agent.step.output.v1",
  "thought": {
    "stream": "I need to type the query into the search box.",
    "summary": "Use the visible search field."
  },
  "status": {
    "state": "running",
    "is_task_complete": false,
    "needs_user_input": false,
    "error": null
  },
  "observation": {
    "page_summary": "Search page is visible.",
    "progress": "Ready to search.",
    "blockers": []
  },
  "actions": [
    {
      "action_type": "dom_type",
      "action_inputs": {"index": 0, "content": "BrowserAide"},
      "rationale": "The search field is indexed."
    }
  ]
}
```

A completion response should use a `finish` action:

```json
{
  "schema_version": "agent.step.output.v1",
  "thought": {"stream": "The answer is ready.", "summary": "Finish with answer."},
  "status": {"state": "completed", "is_task_complete": true, "needs_user_input": false, "error": null},
  "actions": [
    {"action_type": "finish", "action_inputs": {"answer": "Final answer text"}}
  ]
}
```

Human intervention should use `call_user`. The server does not mark this as completed; the extension executes `call_user` and pauses.

```json
{
  "schema_version": "agent.step.output.v1",
  "thought": {"stream": "Login is required.", "summary": "Ask the user to log in."},
  "status": {"state": "waiting_for_user", "is_task_complete": false, "needs_user_input": true, "error": null},
  "actions": [
    {"action_type": "call_user", "action_inputs": {"reason": "Please complete login, then click Resume."}}
  ]
}
```

## StepResponse

The server returns normalized executor actions to the extension.

```json
{
  "schema_version": "agent.step.response.v1",
  "thought": "I need to type the query into the search box.",
  "thought_payload": {"stream": "...", "summary": "..."},
  "actions": [
    {
      "action_type": "dom_type",
      "action_inputs": {
        "index": 0,
        "content": "BrowserAide",
        "selector": "input[name=q]",
        "tag": "input",
        "text": "Search",
        "element_center": [320, 120],
        "_mode": "dom"
      }
    }
  ],
  "action_summary": "dom_type([0]) -> 'BrowserAide'",
  "should_stop": false,
  "final_answer": null,
  "control_mode": "hybrid",
  "status": {"state": "running", "is_task_complete": false, "needs_user_input": false, "error": null},
  "observation": {},
  "runtime": {},
  "metrics": {}
}
```

## Action Source Of Truth

Action definitions are centralized in `server/core/protocol.py` and consumed by:

- `server/services/prompt_builder.py` for model-facing schemas.
- `server/services/action_parser.py` for parser-supported action names.

The extension still executes the stable `action_type` / `action_inputs` shape for compatibility. The parser validates required inputs from the shared protocol before actions reach the executor.

## Validation

Run the lightweight validation suite from the repository root:

```bash
python -m compileall server
python -m unittest discover server/tests
```

If Node.js is available, also check extension syntax:

```bash
node --check extention/background.js
node --check extention/content.js
node --check extention/popup.js
```
