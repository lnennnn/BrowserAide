"""Helpers for extracting displayable fields from partial streamed JSON."""

import re


def decode_partial_json_string(raw: str) -> str:
    """Decode a JSON string fragment as far as possible for live UI display."""
    result = []
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch != "\\":
            result.append(ch)
            i += 1
            continue

        if i + 1 >= len(raw):
            break

        esc = raw[i + 1]
        mapping = {
            '"': '"',
            "\\": "\\",
            "/": "/",
            "b": "\b",
            "f": "\f",
            "n": "\n",
            "r": "\r",
            "t": "\t",
        }
        if esc in mapping:
            result.append(mapping[esc])
            i += 2
            continue

        if esc == "u":
            hex_part = raw[i + 2:i + 6]
            if len(hex_part) < 4:
                break
            try:
                result.append(chr(int(hex_part, 16)))
                i += 6
                continue
            except ValueError:
                result.append("\\u")
                i += 2
                continue

        result.append(esc)
        i += 2

    return "".join(result)


def extract_json_string_after(text: str, start: int) -> str:
    """Extract a possibly incomplete JSON string body after the opening quote."""
    chars = []
    escaped = False

    for ch in text[start:]:
        if escaped:
            chars.append("\\")
            chars.append(ch)
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == '"':
            break
        chars.append(ch)

    if escaped:
        chars.append("\\")

    return decode_partial_json_string("".join(chars))


def extract_partial_thought_stream(vlm_output: str) -> str:
    """Extract thought.stream from a partial JSON response, if available."""
    stream_match = re.search(
        r'"thought"\s*:\s*\{[\s\S]*?"stream"\s*:\s*"',
        vlm_output,
        flags=re.IGNORECASE,
    )
    if stream_match:
        return extract_json_string_after(vlm_output, stream_match.end())

    thought_string_match = re.search(
        r'"thought"\s*:\s*"',
        vlm_output,
        flags=re.IGNORECASE,
    )
    if thought_string_match:
        return extract_json_string_after(vlm_output, thought_string_match.end())

    return ""


def extract_partial_finish_answer(vlm_output: str) -> str:
    """Extract finish.action_inputs.answer from a partial JSON response, if available."""
    finish_answer_match = re.search(
        r'"action_type"\s*:\s*"finish"[\s\S]*?"answer"\s*:\s*"',
        vlm_output,
        flags=re.IGNORECASE,
    )
    if finish_answer_match:
        return extract_json_string_after(vlm_output, finish_answer_match.end())

    answer_match = re.search(
        r'"answer"\s*:\s*"',
        vlm_output,
        flags=re.IGNORECASE,
    )
    if answer_match:
        return extract_json_string_after(vlm_output, answer_match.end())

    return ""
