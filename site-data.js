/* 由 tools/build_site.mjs 生成，不要手改。 */
window.HX_SITE = {
  "items": [
    {
      "no": "HX-01",
      "id": "clause-highlight--min-monoline",
      "file": "components/clause-highlight--min-monoline.html",
      "name": "合同条款高亮卡",
      "world": "极简单线",
      "component": "clause-highlight",
      "form": "卡片",
      "style": "min-monoline",
      "family": "极简",
      "harness": [
        "法律审查",
        "合同与采购审核"
      ],
      "fit": "法律审查、合同与采购审核（也能用在租房、租赁这类要逐条看条款的场景）",
      "desc": "Agent 读完一份合同，把有风险的条款画给用户。底色和墨色，两种颜色。建议改法像抽屉，往下拉。",
      "motion": "抽屉",
      "constraint": "只用两种颜色",
      "zoom": 1,
      "vw": 760,
      "vh": 570
    },
    {
      "no": "HX-02",
      "id": "transfer-confirm--sea-chart",
      "file": "components/transfer-confirm--sea-chart.html",
      "name": "转账确认卡",
      "world": "航海海图",
      "component": "transfer-confirm",
      "form": "卡片",
      "style": "sea-chart",
      "family": "实物",
      "harness": [
        "金融支付助手",
        "个人理财助手"
      ],
      "fit": "金融支付助手、个人理财助手（记账、转账、缴费这类要用户最后点头的场景）",
      "desc": "Agent 在回答里画出的 160×160 小组件。数字像里程表滚动，转账是一次航行。",
      "motion": "数字翻滚",
      "constraint": "小组件尺寸",
      "zoom": 2,
      "vw": 760,
      "vh": 570
    },
    {
      "no": "HX-03",
      "id": "subscription-list--min-type",
      "file": "components/subscription-list--min-type.html",
      "name": "订阅管理卡",
      "world": "极简字排",
      "component": "subscription-list",
      "form": "卡片",
      "style": "min-type",
      "family": "极简",
      "harness": [
        "个人理财助手"
      ],
      "fit": "个人理财助手（订阅、试用、扣款提醒这类要用户最后点头的场景）",
      "desc": "Agent 在回答里画出的 160×160 小组件。几乎只有文字，状态变化时颜色像墨水一样晕开。",
      "motion": "墨水晕染",
      "constraint": "小组件尺寸",
      "zoom": 2,
      "vw": 760,
      "vh": 570
    },
    {
      "no": "HX-04",
      "id": "tool-call-row--min-type",
      "file": "components/tool-call-row--min-type.html",
      "name": "工具调用行",
      "world": "极简字排",
      "component": "tool-call-row",
      "form": "卡片",
      "style": "min-type",
      "family": "极简",
      "harness": [
        "通用核心"
      ],
      "fit": "通用核心（任何 harness 都要有）",
      "desc": "Agent 每调用一次工具就是一行：读取、搜索、运行、编辑。所有变化都是连续的，没有瞬间跳变。只用键盘就能操作。",
      "motion": "丝滑连续",
      "constraint": "只用键盘",
      "zoom": 1,
      "vw": 760,
      "vh": 570
    },
    {
      "no": "HX-05",
      "id": "permission-prompt--min-type",
      "file": "components/permission-prompt--min-type.html",
      "name": "权限确认卡",
      "world": "极简字排",
      "component": "permission-prompt",
      "form": "卡片",
      "style": "min-type",
      "family": "极简",
      "harness": [
        "通用核心"
      ],
      "fit": "通用核心（任何 harness 都要有）",
      "desc": "Agent 要做一件有影响的事之前，停下来问你。字段一个个流进来，位置从一开始就留好，不会跳动。",
      "motion": "丝滑连续",
      "constraint": "流式进场",
      "zoom": 1,
      "vw": 760,
      "vh": 570
    },
    {
      "no": "HX-06",
      "id": "cost-ticker--lab-instrument",
      "file": "components/cost-ticker--lab-instrument.html",
      "name": "费用计数",
      "world": "实验室仪器",
      "component": "cost-ticker",
      "form": "卡片",
      "style": "lab-instrument",
      "family": "实物",
      "harness": [
        "通用核心"
      ],
      "fit": "通用核心（任何 harness 都要有，长时间自动运行的 Agent 尤其需要）",
      "desc": "一台桌面仪器：指针表盘、液晶读数、LED 速率条、示波屏、限额旋钮。Agent 一路花钱，你一眼看到离上限多远。",
      "motion": "待机的生命感",
      "constraint": "流式进场",
      "zoom": 1,
      "vw": 760,
      "vh": 570
    },
    {
      "no": "HX-07",
      "id": "slash-palette--graph-paper",
      "file": "components/slash-palette--graph-paper.html",
      "name": "命令面板",
      "world": "坐标纸工程图",
      "component": "slash-palette",
      "form": "卡片",
      "style": "graph-paper",
      "family": "规整",
      "harness": [
        "通用核心"
      ],
      "fit": "通用核心（任何 harness 都要有）",
      "desc": "输入 / 召出命令面板：分组、模糊搜索、快捷键。选择框在行之间滑动，列表随输入平滑让位。图纸只有纸色和墨色两种颜色。",
      "motion": "丝滑连续",
      "constraint": "只用两种颜色",
      "zoom": 1,
      "vw": 760,
      "vh": 570
    },
    {
      "no": "HX-08",
      "id": "translate-card--toy-slot",
      "file": "components/translate-card--toy-slot.html",
      "name": "翻译对照卡",
      "world": "老虎机转轴",
      "component": "translate-card",
      "form": "卡片",
      "style": "toy-slot",
      "family": "玩具",
      "harness": [
        "翻译助手",
        "出行差旅助手"
      ],
      "fit": "翻译助手、出行差旅助手（出国问路、点餐、订房这类要现学现说的场景）",
      "desc": "Agent 把一句话翻成日语，三个转轴转动、依次停下，停下来的组合就是它的译文；最后三个转轴合成一句。",
      "motion": "一个惊喜（三个转轴合成一句）",
      "constraint": "不加额外限制（带合成音效）",
      "zoom": 1,
      "vw": 760,
      "vh": 570
    },
    {
      "no": "HX-09",
      "id": "file-tree--toy-bubblewrap",
      "file": "components/file-tree--toy-bubblewrap.html",
      "name": "工作区文件树",
      "world": "气泡膜",
      "component": "file-tree",
      "form": "侧边栏",
      "style": "toy-bubblewrap",
      "family": "玩具",
      "harness": [
        "通用核心",
        "开发运维助手"
      ],
      "fit": "通用核心（任何会改文件的 harness 都要有）、开发运维助手",
      "desc": "常驻在工作台左侧。Agent 每改一处，就鼓起一个气泡；按破它，就算你看过了，下面露出“查看差异”和“撤销”。没按破的气泡一眼就能看出还剩几处没看。",
      "motion": "丝滑连续",
      "constraint": "带合成音效",
      "zoom": 0.8,
      "vw": 760,
      "vh": 570
    },
    {
      "no": "HX-10",
      "id": "task-queue--min-type",
      "file": "components/task-queue--min-type.html",
      "name": "任务队列",
      "world": "极简字排",
      "component": "task-queue",
      "form": "侧边栏",
      "style": "min-type",
      "family": "极简",
      "harness": [
        "通用核心"
      ],
      "fit": "通用核心（任何一次要做好几件事的 harness 都要有）",
      "desc": "常驻在工作台一侧，Agent 排着队做的事都在这里。每件任务只有一根细线：做到哪画到哪，做完了变淡，失败了弯成波浪，取消了缩回去。拖动排队的任务换顺序，预计完成时间会跟着重新算。",
      "motion": "描边绘制",
      "constraint": "不加额外限制",
      "zoom": 0.8,
      "vw": 760,
      "vh": 570
    },
    {
      "no": "HX-11",
      "id": "travel--rotary-dial",
      "file": "harnesses/travel--rotary-dial.html",
      "name": "出行差旅 harness",
      "world": "拨盘电话",
      "component": "travel",
      "form": "整套",
      "style": "rotary-dial",
      "family": "实物",
      "harness": [
        "出行差旅助手"
      ],
      "fit": "出行差旅助手（经常出差的人；风险中等，订错了要花钱改）",
      "desc": "一整套工作台，不是单个组件：左边是计划，中间是对话，航班、酒店、天气、翻译、付定金这些卡片按时间出现在对话里，右边是按天分页的行程单。它们互相联动：选了酒店就要确认定金，付了定金计划打勾、行程单标上“已订”，改签航班会重算第一天，赶不上的地方标出“冲突”。输入框旁边是一只能拨的转盘，拨号就是快捷指令。",
      "motion": "描边绘制",
      "constraint": "高对比无障碍",
      "zoom": 1,
      "vw": 1400,
      "vh": 1050
    },
    {
      "no": "HX-12",
      "id": "team-group--vinyl-sleeve",
      "file": "harnesses/team-group--vinyl-sleeve.html",
      "name": "团队群聊 harness",
      "world": "黑胶唱片封套",
      "component": "team-group",
      "form": "整套",
      "style": "vinyl-sleeve",
      "family": "实物",
      "harness": [
        "团队群聊"
      ],
      "fit": "团队群聊（几个人和几个 Agent 一起推进同一件事；风险中等，派错活或记错决定会让大家白忙）",
      "desc": "人和 Agent 都是群成员。群头部是一张唱片封套：唱片标着这次的版本，Agent 在干活时它就转、唱针落下；旁边的曲目单就是这周要做的几件事。消息里能 @ Agent 派活、Agent 之间交接、把群里拍板的事记下来。右边的群信息是一本小册子，成员、定下的事、文件、线程、Agent 名片之间用真的翻页切换，可以抓着右下角拖着翻。全部操作都能用键盘完成，按 ? 看快捷键。",
      "motion": "翻页",
      "constraint": "只用键盘",
      "zoom": 1,
      "vw": 1400,
      "vh": 1050
    },
    {
      "no": "HX-13",
      "id": "general--min-geometry",
      "file": "harnesses/general--min-geometry.html",
      "name": "通用助手 harness",
      "world": "极简几何",
      "component": "general",
      "form": "整套",
      "style": "min-geometry",
      "family": "极简",
      "harness": [
        "通用核心"
      ],
      "fit": "通用核心（什么都能做、动手前讲清楚的通用助手）",
      "desc": "一个什么都能聊、也能动手做事的通用工作台。左边会话，中间对话，右边是 Agent 正在做出来的东西，中间的分隔线可以拖。整套只用圆、方块、线三种形和一种钴蓝：搜索是圆、读取是方块、编辑是线、运行是实心圆；Agent 在想的时候是三个小圆，想完收成一条线；上下文用量是几段方块条。所有变化都是连续的位移和形变。",
      "motion": "丝滑连续",
      "constraint": "流式进场",
      "zoom": 1,
      "vw": 1400,
      "vh": 1050
    },
    {
      "no": "HX-14",
      "id": "task-pay--thermal-receipt",
      "file": "harnesses/task-pay--thermal-receipt.html",
      "name": "LOOM 麓鸣（带支付的任务执行 harness）",
      "world": "热敏小票",
      "component": "task-pay",
      "form": "整套",
      "style": "thermal-receipt",
      "family": "实物",
      "harness": [
        "带支付的任务执行"
      ],
      "fit": "带支付的任务执行（AgentPay：任务、工具调用和付款在同一个工作流里；收款码为演示图样，不能付款）",
      "desc": "让 Agent 替你办一件要花钱的事。对话是主体：Agent 在对话里思考、调工具、出核对单；走到付款这一步，收款码直接打印在对话里，和这笔钱付给谁、对应哪一步、还剩多久放在同一张小票上，你核对完自己扫码。左边是会话，右边是这次任务的进度和订单（订单有版本，能对比、能导出）。所有卡片最上面一行都是结论；金额和倒计时像里程表一样只滚变化的位；新卡片先出占位，字段一个个到齐，布局不跳。",
      "motion": "数字翻滚",
      "constraint": "流式进场",
      "zoom": 1,
      "vw": 1400,
      "vh": 1050
    }
  ],
  "stats": {
    "exhibits": 14,
    "cards": 86,
    "worlds": 29,
    "motions": 13,
    "constraints": 10,
    "scenes": 16,
    "core": [
      {
        "id": "tool-call-row",
        "name": "工具调用行"
      },
      {
        "id": "plan-checklist",
        "name": "计划清单"
      },
      {
        "id": "permission-prompt",
        "name": "权限确认卡"
      },
      {
        "id": "diff-viewer",
        "name": "差异查看器"
      },
      {
        "id": "thinking-block",
        "name": "思考块"
      },
      {
        "id": "context-meter",
        "name": "上下文用量"
      },
      {
        "id": "status-chip",
        "name": "状态胶囊"
      },
      {
        "id": "composer",
        "name": "输入框"
      },
      {
        "id": "checkpoint-rewind",
        "name": "检查点"
      },
      {
        "id": "slash-palette",
        "name": "命令面板"
      },
      {
        "id": "streaming-text",
        "name": "流式文本"
      },
      {
        "id": "interrupt-bar",
        "name": "中断条"
      },
      {
        "id": "cost-ticker",
        "name": "费用计数"
      },
      {
        "id": "error-banner",
        "name": "错误横幅"
      },
      {
        "id": "fallback-notice",
        "name": "降级提示"
      },
      {
        "id": "session-list",
        "name": "会话列表"
      },
      {
        "id": "file-tree",
        "name": "工作区文件树"
      },
      {
        "id": "task-queue",
        "name": "任务队列"
      },
      {
        "id": "context-shelf",
        "name": "上下文书架"
      },
      {
        "id": "agent-roster",
        "name": "子 Agent 名册"
      },
      {
        "id": "tool-permissions",
        "name": "工具权限面板"
      },
      {
        "id": "outline-nav",
        "name": "对话大纲"
      },
      {
        "id": "model-switcher",
        "name": "模型切换"
      },
      {
        "id": "attachment-card",
        "name": "附件卡"
      },
      {
        "id": "code-block",
        "name": "代码块"
      },
      {
        "id": "artifact-pane",
        "name": "产物面板"
      },
      {
        "id": "voice-input",
        "name": "语音输入"
      },
      {
        "id": "rate-limit",
        "name": "限流等待"
      },
      {
        "id": "media-viewer",
        "name": "图片查看器"
      },
      {
        "id": "mention-picker",
        "name": "引用选择器"
      },
      {
        "id": "new-message-pill",
        "name": "新消息提示"
      },
      {
        "id": "share-export",
        "name": "分享与导出"
      },
      {
        "id": "thread-reply",
        "name": "线程回复"
      },
      {
        "id": "task-run",
        "name": "任务执行侧栏"
      }
    ]
  }
};
