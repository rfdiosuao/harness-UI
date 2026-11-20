# 组件索引

每个组件的 `<head>` 里有 `hx-component`、`hx-style`、`hx-harness` 三个标记，页面标题下面也写着“适合的 harness”。新加组件时，在这里补一行。

| 文件 | 卡片 | 视觉世界 | 动效 | 限制 | 适合的 harness |
|---|---|---|---|---|---|
| [clause-highlight--min-monoline.html](clause-highlight--min-monoline.html) | 合同条款高亮卡 | 极简单线 | 抽屉 | 只用两种颜色 | **法律审查**、合同与采购审核 |
| [transfer-confirm--sea-chart.html](transfer-confirm--sea-chart.html) | 转账确认卡 | 航海海图 | 数字翻滚 | 小组件尺寸 | **金融支付助手**、个人理财助手 |
| [subscription-list--min-type.html](subscription-list--min-type.html) | 订阅管理卡 | 极简字排 | 墨水晕染 | 小组件尺寸 | **个人理财助手** |
| [translate-card--toy-slot.html](translate-card--toy-slot.html) | 翻译对照卡 | 老虎机转轴 | 一个惊喜（三个转轴合成一句） | 不加额外限制（带合成音效） | **翻译助手**、出行差旅助手 |

## 怎么挑 harness

- 先想你的 harness 里，用户最常要“看一眼、点一下”的是什么，再找对应的卡片。
- 法律审查：条款高亮、把握程度、来源引用、澄清追问。
- 金融支付：转账确认、账单拆分、预算环、订阅管理、危险操作确认。
- 出行差旅：航班、酒店比价、行程时间线、翻译对照。
- 开发运维：部署进度、危险操作确认、工单。
- 通用：选项选择、澄清追问、多方案对比、记忆更新。

完整对应关系在 [../prompts/pools.json](../prompts/pools.json) 的 `harness` 字段里。只想从某一类里抽：

```bash
node prompts/roll.mjs --harness 法律审查
```
