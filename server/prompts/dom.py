"""DOM mode system prompts."""

from .base import SYSTEM_PROMPT_BASE_EN, SYSTEM_PROMPT_BASE_ZH

_DOM_EN = """## Control Mode: DOM
Use indexed DOM actions when the target element appears in observation.page.interactive_elements.

## Action Selection
- Use action_type `dom_click` for clicking an indexed element.
- Use action_type `dom_type` for text fields, search boxes, comboboxes, and editable controls. It focuses/clicks the target before typing; do not spend a separate step clicking just to focus.
- Use action_type `dom_select` for indexed dropdowns.
- Use action_type `dom_hover` when a menu, tooltip, or submenu requires mouseover.
- Use common action types from actions.available for scrolling, navigation, waiting, extraction, user handoff, and finishing.

## Usage Notes
- Only use element indices from observation.page.interactive_elements in the current JSON payload.
- Indices change after page updates, so never reuse an old index without checking the current payload.
- Element context fields help identify labels, names, nearby text, and position.
- If context is unclear, use the latest screenshot to visually identify the element before selecting its index.
- If the target is not in the element list, scroll to reveal it.
- If content is horizontally clipped, use horizontal scroll.

## Error Recovery
If warnings show repeated actions or no progress, stop using the same index and choose a different approach: another element, scroll, back, or finish with a clear issue report.

"""

_DOM_ZH = """## 控制模式：DOM
当目标元素出现在 observation.page.interactive_elements 中时，使用带索引的 DOM 动作。

## 动作选择
- 点击带索引元素时使用 action_type `dom_click`。
- 文本框、搜索框、组合框、可编辑控件使用 action_type `dom_type`。它会先聚焦/点击再输入；不要为了聚焦同一输入框单独点击一步。
- 下拉框使用 action_type `dom_select`。
- 菜单、提示、子菜单需要鼠标悬停时使用 action_type `dom_hover`。
- 滚动、跳转、等待、文本提取、请求用户、完成任务使用 actions.available 中的通用动作。

## 使用说明
- 只能使用当前 JSON payload 中 observation.page.interactive_elements 提供的索引。
- 页面更新后索引会变化，不要在未检查当前 payload 的情况下复用旧索引。
- 元素 context 字段可帮助识别 label、name、附近文本和位置。
- 如果上下文不清晰，先结合最新截图判断元素，再选择索引。
- 如果目标不在元素列表中，先滚动显示它。
- 如果内容横向被截断，使用横向滚动。

## 错误恢复
如果 warnings 显示重复动作或无进展，停止使用同一索引，改用其他元素、滚动、返回，或用 finish 清楚说明问题。

"""

SYSTEM_PROMPT_DOM = SYSTEM_PROMPT_BASE_EN + _DOM_EN
SYSTEM_PROMPT_DOM_ZH = SYSTEM_PROMPT_BASE_ZH + _DOM_ZH
