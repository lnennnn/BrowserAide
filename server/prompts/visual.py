"""Visual mode system prompts."""

from .base import SYSTEM_PROMPT_BASE_EN, SYSTEM_PROMPT_BASE_ZH

_VISUAL_EN = """## Control Mode: Visual
Use visual actions with normalized coordinates from the latest screenshot.

## Action Selection
- Use action_type `click` to click a visible target by coordinates.
- Use action_type `type` for visible text fields and editable controls. It focuses/clicks before typing; do not spend a separate click just to focus.
- Use action_type `hover` when a menu, tooltip, or submenu requires mouseover.
- Use common action types from actions.available for scrolling, navigation, waiting, extraction, user handoff, and finishing.

## Coordinate Rules
- Coordinates are normalized 0-1000: (0,0) is top-left and (1000,1000) is bottom-right.
- Aim at the center of the visible target.
- Coordinates always refer to the latest screenshot only.

## Usage Notes
- If the target is not visible vertically, scroll up or down.
- If content is horizontally clipped, use horizontal scroll.
- If observation.page.extracted_text or observation.page.extracted_text_summary exists, use it before scrolling more unless it is missing, truncated, or insufficient.

## Error Recovery
If warnings show repeated clicks or no progress, stop using the same coordinates and choose a different location, scroll, or finish with a clear issue report.

"""

_VISUAL_ZH = """## 控制模式：Visual
使用最新截图中的归一化坐标执行视觉动作。

## 动作选择
- 点击可见目标时使用 action_type `click`。
- 可见文本框和可编辑控件使用 action_type `type`。它会先聚焦/点击再输入；不要为了聚焦单独点击一步。
- 菜单、提示、子菜单需要鼠标悬停时使用 action_type `hover`。
- 滚动、跳转、等待、文本提取、请求用户、完成任务使用 actions.available 中的通用动作。

## 坐标规则
- 坐标是 0-1000 归一化坐标：(0,0) 为左上角，(1000,1000) 为右下角。
- 尽量点击目标元素中心。
- 坐标始终只对应最新截图。

## 使用说明
- 如果目标垂直方向不可见，先上下滚动。
- 如果内容横向被截断，使用横向滚动。
- 如果 observation.page.extracted_text 或 observation.page.extracted_text_summary 存在，先使用它们；除非缺失、截断或不足，否则不要继续滚动阅读。

## 错误恢复
如果 warnings 显示重复点击或无进展，停止使用同一坐标，改点其他位置、滚动，或用 finish 清楚说明问题。

"""

SYSTEM_PROMPT_VISUAL = SYSTEM_PROMPT_BASE_EN + _VISUAL_EN
SYSTEM_PROMPT_VISUAL_ZH = SYSTEM_PROMPT_BASE_ZH + _VISUAL_ZH
