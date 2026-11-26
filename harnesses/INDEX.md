# 整套 harness 索引

一整个工作台，不是单个组件：用 `node prompts/roll.mjs --whole` 抽「行业 × 布局 × 视觉世界 × 动效 × 限制」，连同这类 harness 该有的一组组件一起做。每个页面的 `<head>` 里有 `hx-component`（harness id）、`hx-form`（whole）、`hx-style`、`hx-harness` 四个标记。新做一套，在这里补一行，再跑 `node tools/build_site.mjs`。

| 文件 | 整套 | 视觉世界 | 动效 | 限制 | 适合的 harness |
|---|---|---|---|---|---|
| [travel--rotary-dial.html](travel--rotary-dial.html) | 出行差旅 harness（三栏：计划 / 对话 / 行程单） | 拨盘电话 | 描边绘制 | 高对比无障碍 | **出行差旅助手**（风险中等：订错了要花钱改） |
| [team-group--vinyl-sleeve.html](team-group--vinyl-sleeve.html) | 团队群聊 harness（群聊：会话 / 群消息 / 群信息） | 黑胶唱片封套 | 翻页 | 只用键盘 | **团队群聊**（几个人和几个 Agent 在一个群里推进同一件事） |
| [general--min-geometry.html](general--min-geometry.html) | 通用助手 harness（对话｜产物分屏：会话 / 对话 / 产物） | 极简几何 | 丝滑连续 | 流式进场 | **通用核心**（什么都能聊、也能动手做事的通用助手） |
