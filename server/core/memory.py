"""Agent memory and context management."""

import re
import hashlib
from enum import IntEnum
from typing import Optional, List, Dict, Any
from urllib.parse import urlparse
from .config import Config


class ContextPriority(IntEnum):
    """Priority levels used when rendering context history."""
    LOW = 0
    MEDIUM = 1
    HIGH = 2
    CRITICAL = 3


class AgentMemory:
    """Stores conversation state, screenshots, action history, and loop detection state."""

    def __init__(self):
        self.conversation_history: List[Dict] = []
        self.image_history: List[str] = []
        self.latest_extracted_text_summary: Optional[Dict[str, Any]] = None


        self.step_records: List[Dict[str, Any]] = []


        self.action_stack: List[str] = []
        self.failed_action_counts: Dict[str, int] = {}
        self.consecutive_failures: int = 0
        self.last_action_success: bool = True
        self.no_change_count: int = 0
        self.last_screenshot_hash: Optional[str] = None
        self.loop_warnings_count: int = 0



    def add_message(
        self,
        role: str,
        content: str,
        dedupe_same_role: bool = False
    ) -> None:
        """Add message."""
        if not content:
            return

        if role == "user":
            dedupe_same_role = True

        if dedupe_same_role:
            if any(
                msg["role"] == role and msg["content"] == content
                for msg in self.conversation_history
            ):
                return
        else:
            if self.conversation_history:
                last = self.conversation_history[-1]
                if last["role"] == role and last["content"] == content:
                    return

        self.conversation_history.append({"role": role, "content": content})

        max_len = Config.MAX_CONVERSATION_HISTORY
        if len(self.conversation_history) > max_len:
            self.conversation_history = self.conversation_history[-max_len:]

    def add_screenshot(self, screenshot_b64: str) -> List[str]:
        """Add screenshot."""
        if not screenshot_b64:
            return self.image_history

        self.image_history.append(screenshot_b64)

        max_len = Config.MAX_IMAGE_HISTORY
        if len(self.image_history) > max_len:
            self.image_history = self.image_history[-max_len:]

        return self.image_history

    def remember_extracted_text(self, extracted_text: Optional[str]) -> None:
        """Store a compact summary of the latest extracted page text for later steps."""
        if not extracted_text:
            return
        self.latest_extracted_text_summary = self._summarize_extracted_text(extracted_text)

    def get_extracted_text_summary(self) -> Optional[Dict[str, Any]]:
        return dict(self.latest_extracted_text_summary) if self.latest_extracted_text_summary else None



    def record_action_step(
        self,
        action_summary: str,
        actions: List[Dict] = None,
        thought: str = "",
        screenshot_b64: str = "",
        scroll_info: Dict = None,
        dom_elements: List[Dict] = None,
        extracted_text: str = None,
        url: str = None,
        title: str = None
    ) -> None:
        """Record action step."""
        snapshot_before = self._build_perception_snapshot(
            screenshot_b64=screenshot_b64,
            scroll_info=scroll_info,
            dom_elements=dom_elements,
            extracted_text=extracted_text,
            url=url,
            title=title
        )

        thought_summary = thought.strip().replace("\n", " ")
        if len(thought_summary) > 120:
            thought_summary = thought_summary[:117] + "..."

        priority, is_milestone = self._classify_action_priority(
            action_summary, actions or []
        )

        self.step_records.append({
            "action_summary": action_summary or "unknown",
            "actions": actions or [],
            "thought": thought_summary,
            "snapshot_before": snapshot_before,
            "result_feedback": None,
            "exec_success": None,
            "exec_error": None,
            "priority": priority,
            "is_milestone": is_milestone,
        })

    def update_last_action_feedback(
        self,
        screenshot_b64: str,
        scroll_info: Dict = None,
        dom_elements: List[Dict] = None,
        extracted_text: str = None,
        url: str = None,
        title: str = None,
        last_action_result: Dict = None,
        max_consecutive_failures: int = None
    ) -> None:
        """Update last action feedback."""
        if not self.step_records:
            return

        last_record = self.step_records[-1]
        if last_record.get("result_feedback"):
            return

        if last_action_result:
            last_record["exec_success"] = last_action_result.get("success", True)
            last_record["exec_error"] = last_action_result.get("error")

            success = last_action_result.get("success", True)
            error = last_action_result.get("error")
            self.track_action_result(success, error, max_consecutive_failures)

        current_snapshot = self._build_perception_snapshot(
            screenshot_b64=screenshot_b64,
            scroll_info=scroll_info,
            dom_elements=dom_elements,
            extracted_text=extracted_text,
            url=url,
            title=title
        )
        previous_snapshot = last_record.get("snapshot_before")
        feedback = self._describe_result_feedback(
            previous_snapshot, current_snapshot, last_record
        )
        last_record["result_feedback"] = feedback

        self._adjust_priority_from_feedback(last_record, previous_snapshot, current_snapshot)

    def _classify_action_priority(
        self, action_summary: str, actions: List[Dict]
    ) -> tuple:
        """Classify action priority."""
        action_type = ""
        if actions:
            action_type = actions[0].get("action_type", "").lower()

        if action_type in ("goto", "finish"):
            return ContextPriority.CRITICAL, True

        if action_type in ("back",):
            return ContextPriority.HIGH, False

        if action_type in ("scroll",):
            return ContextPriority.LOW, False

        if "extract" in action_type:
            return ContextPriority.HIGH, False

        return ContextPriority.MEDIUM, False

    def _adjust_priority_from_feedback(
        self,
        record: Dict,
        previous_snapshot: Dict[str, Any],
        current_snapshot: Dict[str, Any]
    ) -> None:
        """Adjust priority from feedback."""
        if not previous_snapshot:
            return

        prev_url = previous_snapshot.get("url", "")
        curr_url = current_snapshot.get("url", "")
        prev_title = previous_snapshot.get("title", "")
        curr_title = current_snapshot.get("title", "")

        # Only treat URL change as real navigation if both snapshots have URLs
        url_changed = prev_url and curr_url and curr_url != prev_url
        title_changed = prev_title and curr_title and curr_title != prev_title

        if url_changed:
            record["priority"] = ContextPriority.CRITICAL
            record["is_milestone"] = True
            return

        if title_changed:
            if record["priority"] < ContextPriority.HIGH:
                record["priority"] = ContextPriority.HIGH
            return

        prev_hash = previous_snapshot.get("screenshot_hash", "")
        curr_hash = current_snapshot.get("screenshot_hash", "")
        if prev_hash and curr_hash and prev_hash == curr_hash:
            record["priority"] = ContextPriority.LOW



    def get_formatted_history(self) -> str:
        """Get formatted history."""
        if not self.step_records:
            return ""

        total = len(self.step_records)
        max_display = Config.MAX_HISTORY_DISPLAY

        if total <= max_display:
            return self._render_all_steps()

        return self._render_adaptive_history()

    def _render_all_steps(self) -> str:
        """Render all steps."""
        lines = []
        for i, record in enumerate(self.step_records):
            line = self._format_step_line(i + 1, record)
            lines.append(line)
        return f"## Action History ({len(lines)} steps)\n" + "\n".join(lines)

    def get_structured_history(self) -> List[Dict[str, Any]]:
        """Return compact machine-readable history for the structured prompt."""
        max_display = Config.MAX_HISTORY_DISPLAY
        start = max(0, len(self.step_records) - max_display)
        steps = []

        for i, record in enumerate(self.step_records[start:], start=start + 1):
            steps.append({
                "step": i,
                "thought": record.get("thought", ""),
                "action_summary": record.get("action_summary") or "unknown",
                "result": record.get("result_feedback") or "pending",
                "exec_success": record.get("exec_success"),
                "exec_error": record.get("exec_error"),
                "priority": int(record.get("priority", ContextPriority.MEDIUM)),
                "is_milestone": bool(record.get("is_milestone")),
            })

        return steps

    def get_warnings(self) -> List[str]:
        """Expose current risk signals without adding more prompt-only messages."""
        warnings = []
        if self.consecutive_failures:
            warnings.append(f"{self.consecutive_failures} consecutive action failure(s)")
        if self.no_change_count:
            warnings.append(f"screen unchanged for {self.no_change_count} step(s)")
        if self.loop_warnings_count:
            warnings.append(f"{self.loop_warnings_count} loop warning(s)")
        return warnings

    def _render_adaptive_history(self) -> str:
        """Render adaptive history."""
        total = len(self.step_records)
        recent_count = min(5, Config.MAX_HISTORY_DISPLAY // 2)
        recent_start = total - recent_count

        milestones = [
            (i, r) for i, r in enumerate(self.step_records)
            if r.get("is_milestone") and i < recent_start
        ]

        sections = []
        header = f"## Action History ({total} steps)"

        if milestones:
            milestone_lines = []
            for i, record in milestones:
                milestone_lines.append(self._format_step_line(i + 1, record, marker="★"))
            sections.append("--- Key Milestones ---\n" + "\n".join(milestone_lines))

        middle_start = 0
        middle_end = recent_start
        if milestones:
            middle_start = milestones[-1][0] + 1

        if middle_start < middle_end:
            middle_records = self.step_records[middle_start:middle_end]
            compressed = self._compress_steps(middle_records, offset=middle_start + 1)
            if compressed:
                sections.append("--- Earlier Steps (compressed) ---\n" + "\n".join(compressed))

        recent_lines = []
        for i in range(recent_start, total):
            recent_lines.append(self._format_step_line(i + 1, self.step_records[i]))
        sections.append("--- Recent Steps ---\n" + "\n".join(recent_lines))

        return header + "\n" + "\n".join(sections)

    def _format_step_line(self, step_num: int, record: Dict, marker: str = "") -> str:
        action_summary = record.get("action_summary") or "unknown"
        result_feedback = record.get("result_feedback") or "pending"
        suffix = f" {marker}" if marker else ""

        if record.get("exec_success") is False:
            suffix = f" ✗{suffix}"

        return f"[{step_num}] Action: {action_summary} | Result: {result_feedback}{suffix}"

    def _compress_steps(self, records: List[Dict], offset: int) -> List[str]:
        """Compress steps."""
        if not records:
            return []

        lines = []
        i = 0
        while i < len(records):
            record = records[i]
            priority = record.get("priority", ContextPriority.MEDIUM)

            if priority >= ContextPriority.MEDIUM:
                lines.append(self._format_step_line(offset + i, record))
                i += 1
                continue

            # LOW priority: try to find consecutive run of same type
            run_start = i
            run_type = self._get_step_category(record)

            while i < len(records):
                r = records[i]
                if r.get("priority", ContextPriority.MEDIUM) >= ContextPriority.MEDIUM:
                    break
                if self._get_step_category(r) != run_type:
                    break
                i += 1

            run_length = i - run_start
            start_num = offset + run_start
            end_num = offset + i - 1

            if run_length == 1:
                lines.append(self._format_step_line(start_num, records[run_start]))
            else:
                summary = self._summarize_run(run_type, run_length)
                lines.append(f"[{start_num}-{end_num}] {summary}")

        return lines

    @staticmethod
    def _get_step_category(record: Dict) -> str:
        """Get step category."""
        feedback = (record.get("result_feedback") or "").lower()
        summary = (record.get("action_summary") or "").lower()

        if "no visible change" in feedback:
            return "no_change"
        if "scroll" in summary:
            return "scroll"
        if "page content updated" in feedback:
            return "minor_update"
        return "other_low"

    @staticmethod
    def _summarize_run(category: str, count: int) -> str:
        """Summarize run."""
        if category == "no_change":
            return f"({count} actions with no visible change — suppressed)"
        if category == "scroll":
            return f"(scrolled {count} times)"
        if category == "minor_update":
            return f"({count} minor page updates — suppressed)"
        return f"({count} low-impact actions — suppressed)"



    def track_action(self, action_signature: str) -> Optional[str]:
        """Track action."""
        self.action_stack.append(action_signature)
        if len(self.action_stack) > Config.ACTION_STACK_SIZE:
            self.action_stack.pop(0)

        warnings = []

        if len(self.action_stack) >= Config.LOOP_DETECT_THRESHOLD:
            recent = self.action_stack[-Config.LOOP_DETECT_THRESHOLD:]
            if len(set(recent)) == 1:
                warning = self._handle_consecutive_loop(action_signature)
                if warning:
                    warnings.append(warning)

        if not warnings:
            similar_warning = self._detect_similar_coordinate_actions()
            if similar_warning:
                warnings.append(similar_warning)

        pattern_warning = self._detect_pattern_loop()
        if pattern_warning:
            warnings.append(pattern_warning)

        if warnings:
            return "\n".join(warnings)
        return None

    def _handle_consecutive_loop(self, signature: str) -> Optional[str]:
        self.failed_action_counts[signature] = self.failed_action_counts.get(signature, 0) + 1
        count = self.failed_action_counts[signature]
        self.loop_warnings_count += 1

        if count >= Config.MAX_SAME_ACTION_FAILURES:
            warning = (
                f"[System] CRITICAL: You have repeated '{signature}' {count} times "
                f"without any progress. This action is NOT working.\n"
                f"You MUST try a COMPLETELY DIFFERENT approach:\n"
                f"- If click doesn't work, try hover() or dom_hover() — menus often need mouseover\n"
                f"- If stuck on an element, try scrolling to find alternative elements\n"
                f"- If input doesn't work, try clicking the field first, then typing\n"
                f"- If on a PDF/image, extract information from the screenshot directly\n"
                f"- Try navigating to a different page using back() or goto()\n"
                f"- Consider using finish() to report current progress and ask for help"
            )
            self.add_message("system", warning)
            return warning
        elif count >= 2:
            warning = (
                f"[System] Warning: Action '{signature}' repeated multiple times ({count}x). "
                f"The same approach is not working. Try an alternative:\n"
                f"- If clicking, try hover() instead — some elements respond to mouseover only\n"
                f"- Scroll to reveal more elements\n"
                f"- Try a different element or coordinate\n"
                f"- Use wait() if page is still loading"
            )
            self.add_message("system", warning)
            return warning
        else:
            warning = (
                f"[System] Notice: Action '{signature}' repeated 3 times. "
                f"Consider trying a different approach if this doesn't work."
            )
            self.add_message("system", warning)
            return warning

    def _detect_similar_coordinate_actions(self) -> Optional[str]:
        """Detect similar coordinate actions."""
        if len(self.action_stack) < 3:
            return None

        recent = self.action_stack[-4:]

        coord_pattern = re.compile(r'(click|hover|type).*\((\d+),\s*(\d+)\)')
        coord_actions = []
        for action in recent:
            match = coord_pattern.search(action)
            if match:
                action_type = match.group(1)
                x, y = int(match.group(2)), int(match.group(3))
                coord_actions.append((action_type, x, y))

        if len(coord_actions) >= 3:
            clicks = [a for a in coord_actions if a[0] == 'click']

            if len(clicks) >= 3:
                xs = [c[1] for c in clicks]
                ys = [c[2] for c in clicks]
                x_range = max(xs) - min(xs)
                y_range = max(ys) - min(ys)

                if x_range <= 50 and y_range <= 50:
                    avg_x = sum(xs) // len(xs)
                    avg_y = sum(ys) // len(ys)

                    self.loop_warnings_count += 1
                    warning = (
                        f"[System] Warning: Multiple clicks near the same area ({avg_x}, {avg_y}) detected.\n"
                        f"If clicking is not working, try these alternatives:\n"
                        f"- Use hover() or dom_hover() instead — dropdown menus often require mouseover\n"
                        f"- Try dom_click() with the element's index if available\n"
                        f"- Scroll to ensure the element is fully visible\n"
                        f"- Check if a modal/overlay is blocking the element"
                    )
                    self.add_message("system", warning)
                    return warning

        return None

    def _detect_pattern_loop(self) -> Optional[str]:
        """Detect pattern loop."""
        if len(self.action_stack) < Config.PATTERN_LOOP_MIN_LENGTH * Config.PATTERN_LOOP_REPETITIONS * 2:
            return None

        for pattern_len in range(Config.PATTERN_LOOP_MIN_LENGTH, 5):
            required_len = pattern_len * Config.PATTERN_LOOP_REPETITIONS
            if len(self.action_stack) < required_len:
                continue

            recent = self.action_stack[-required_len:]
            pattern = recent[:pattern_len]

            is_pattern = True
            for i in range(Config.PATTERN_LOOP_REPETITIONS):
                start = i * pattern_len
                if recent[start:start + pattern_len] != pattern:
                    is_pattern = False
                    break

            if is_pattern and len(set(pattern)) > 1:
                self.loop_warnings_count += 1
                pattern_str = " → ".join(pattern)
                warning = (
                    f"[System] Pattern loop detected: [{pattern_str}] repeated {Config.PATTERN_LOOP_REPETITIONS} times.\n"
                    f"You are stuck in a loop. Break out by trying:\n"
                    f"- Scroll in a different direction\n"
                    f"- Navigate to a different page\n"
                    f"- Try a completely different interaction method"
                )
                self.add_message("system", warning)
                return warning

        return None

    def track_action_result(self, success: bool, error: str = None, max_consecutive_failures: int = None) -> Optional[str]:
        """Track action result."""
        failure_limit = max(1, max_consecutive_failures if max_consecutive_failures is not None else Config.MAX_CONSECUTIVE_FAILURES)
        self.last_action_success = success

        if success:
            self.consecutive_failures = 0
            return None
        else:
            self.consecutive_failures += 1

            if self.consecutive_failures >= failure_limit:
                warning = (
                    f"[System] CRITICAL: {self.consecutive_failures} consecutive action failures.\n"
                    f"Last error: {error or 'Unknown'}\n"
                    f"The current approach is not working. Consider:\n"
                    f"- Waiting for the page to fully load\n"
                    f"- Trying different elements or coordinates\n"
                    f"- Using finish() to report the issue"
                )
                self.add_message("system", warning)
                return warning

        return None

    def track_screen_change(self, screenshot_b64: str) -> Optional[str]:
        """Track screen change."""
        sample = screenshot_b64[:10000] if len(screenshot_b64) > 10000 else screenshot_b64
        current_hash = hashlib.md5(sample.encode()).hexdigest()

        if self.last_screenshot_hash == current_hash:
            self.no_change_count += 1

            if self.no_change_count >= Config.NO_CHANGE_MAX_COUNT:
                warning = (
                    f"[System] Warning: Screen has not changed after {self.no_change_count} actions.\n"
                    f"Your actions may not be having any effect. Try:\n"
                    f"- Clicking on a different area\n"
                    f"- Using scroll() to reveal new content\n"
                    f"- Checking if there's a modal or overlay blocking interaction\n"
                    f"- Using wait() if the page is still loading"
                )
                self.add_message("system", warning)
                return warning
        else:
            self.no_change_count = 0

        self.last_screenshot_hash = current_hash
        return None

    def should_force_stop(self, max_consecutive_failures: int = None) -> tuple:
        """Should force stop."""
        failure_limit = max(1, max_consecutive_failures if max_consecutive_failures is not None else Config.MAX_CONSECUTIVE_FAILURES)
        if self.consecutive_failures >= failure_limit:
            return True, f"Too many consecutive failures ({self.consecutive_failures})"

        if self.loop_warnings_count >= 5:
            return True, f"Too many loop warnings ({self.loop_warnings_count})"

        if self.no_change_count >= Config.NO_CHANGE_MAX_COUNT * 2:
            return True, f"Screen unchanged for too long ({self.no_change_count} actions)"

        return False, ""



    def reset(self) -> None:
        """Reset."""
        self.conversation_history.clear()
        self.image_history.clear()
        self.latest_extracted_text_summary = None
        self.step_records.clear()

        self.action_stack.clear()
        self.failed_action_counts.clear()
        self.consecutive_failures = 0
        self.last_action_success = True
        self.no_change_count = 0
        self.last_screenshot_hash = None
        self.loop_warnings_count = 0

    def get_stats(self) -> Dict[str, Any]:
        """Get stats."""
        milestone_count = sum(1 for r in self.step_records if r.get("is_milestone"))
        priority_dist = {}
        for r in self.step_records:
            p = r.get("priority", ContextPriority.MEDIUM)
            name = ContextPriority(p).name
            priority_dist[name] = priority_dist.get(name, 0) + 1

        return {
            "conversation_length": len(self.conversation_history),
            "image_count": len(self.image_history),
            "has_extracted_text_summary": bool(self.latest_extracted_text_summary),
            "action_stack_size": len(self.action_stack),
            "step_record_count": len(self.step_records),
            "milestone_count": milestone_count,
            "priority_distribution": priority_dist,
            "loop_detection": {
                "consecutive_failures": self.consecutive_failures,
                "no_change_count": self.no_change_count,
                "loop_warnings_count": self.loop_warnings_count,
                "failed_action_counts": dict(self.failed_action_counts)
            }
        }



    @staticmethod
    def _build_perception_snapshot(
        screenshot_b64: str,
        scroll_info: Dict = None,
        dom_elements: List[Dict] = None,
        extracted_text: str = None,
        url: str = None,
        title: str = None
    ) -> Dict[str, Any]:
        """Build perception snapshot."""
        sample = screenshot_b64[:10000] if screenshot_b64 else ""
        screenshot_hash = hashlib.md5(sample.encode()).hexdigest() if sample else ""
        scroll_info = scroll_info or {}

        return {
            "screenshot_hash": screenshot_hash,
            "scroll_y": float(scroll_info.get("y", 0) or 0),
            "scroll_x": float(scroll_info.get("x", 0) or 0),
            "dom_count": len(dom_elements) if dom_elements else 0,
            "has_extracted_text": bool(extracted_text),
            "url": url or "",
            "title": title or "",
        }

    @staticmethod
    def _summarize_extracted_text(extracted_text: str) -> Dict[str, Any]:
        """Compress the last extracted page text so later steps keep only a light summary."""
        raw = (extracted_text or "").strip()
        was_truncated = "...[TEXT TRUNCATED]..." in raw or "[TEXT TRUNCATED]" in raw

        normalized_lines = []
        seen = set()
        for line in raw.splitlines():
            cleaned = re.sub(r"\s+", " ", line).strip()
            if not cleaned or cleaned in seen:
                continue
            seen.add(cleaned)
            normalized_lines.append(cleaned)

        summary_parts = []
        budget = 900
        for line in normalized_lines:
            if len(line) <= 1:
                continue
            if summary_parts and budget - len(line) < 0:
                break
            summary_parts.append(line)
            budget -= len(line) + 1
            if len(summary_parts) >= 12:
                break

        if not summary_parts and raw:
            snippet = re.sub(r"\s+", " ", raw)[:900].strip()
            if snippet:
                summary_parts.append(snippet)

        summary_text = "\n".join(summary_parts)
        if was_truncated and "[TEXT TRUNCATED]" not in summary_text:
            summary_text = (summary_text + "\n[TEXT TRUNCATED]").strip()

        return {
            "summary": summary_text or None,
            "char_count": len(raw),
            "was_truncated": was_truncated,
        }

    @staticmethod
    def _extract_domain(url: str) -> str:
        """Extract domain."""
        try:
            parsed = urlparse(url)
            host = parsed.hostname or url
            if host.startswith("www."):
                host = host[4:]
            return host
        except Exception:
            return url[:60] if url else ""

    def _describe_result_feedback(
        self,
        previous_snapshot: Dict[str, Any],
        current_snapshot: Dict[str, Any],
        record: Dict[str, Any] = None
    ) -> str:
        """Describe result feedback."""
        if record and record.get("exec_success") is False:
            error_msg = record.get("exec_error") or "unknown error"
            return f"FAILED: {error_msg}."

        if not previous_snapshot:
            title = current_snapshot.get("title", "")
            url = current_snapshot.get("url", "")
            if title:
                return f"Page loaded: \"{title}\"."
            if url:
                return f"Page loaded: {self._extract_domain(url)}."
            return "Observed new page state."

        parts = []

        prev_url = previous_snapshot.get("url", "")
        curr_url = current_snapshot.get("url", "")
        prev_title = previous_snapshot.get("title", "")
        curr_title = current_snapshot.get("title", "")

        url_changed = prev_url and curr_url and curr_url != prev_url
        title_changed = prev_title and curr_title and curr_title != prev_title

        if url_changed:
            domain = self._extract_domain(curr_url)
            if curr_title:
                parts.append(f"navigated to {domain} — \"{curr_title}\"")
            else:
                parts.append(f"navigated to {domain}")
        elif title_changed:
            parts.append(f"page title changed to \"{curr_title}\"")

        prev_y = previous_snapshot.get("scroll_y", 0.0)
        curr_y = current_snapshot.get("scroll_y", 0.0)
        if abs(curr_y - prev_y) >= 5:
            direction = "down" if curr_y > prev_y else "up"
            parts.append(f"scrolled {direction}")

        if (previous_snapshot.get("has_extracted_text") !=
                current_snapshot.get("has_extracted_text") and
                current_snapshot.get("has_extracted_text")):
            parts.append("page text was extracted")

        if not parts:
            if previous_snapshot.get("screenshot_hash") != current_snapshot.get("screenshot_hash"):
                parts.append("page content updated")
            else:
                parts.append("no visible change")

        return "; ".join(parts[:2]) + "."
