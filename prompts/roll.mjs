#!/usr/bin/env node
// 随机提示词组合器：从 pools.json 里抽「卡片 × 视觉世界 × 动效 × 限制 × 场景」，拼成一条可以直接复制的提示词。
//
// 用法：
//   node prompts/roll.mjs              出 1 条
//   node prompts/roll.mjs -n 6         出 6 条（同一次里卡片和视觉世界不重复）
//   node prompts/roll.mjs -n 6 -s 42   固定种子，结果可复现
//   node prompts/roll.mjs --card flight-card --world split-flap   钉住其中几项，其余随机
//   node prompts/roll.mjs --list       列出所有可钉住的 id

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pools = JSON.parse(fs.readFileSync(path.join(dir, 'pools.json'), 'utf8'));

const argv = process.argv.slice(2);
const opt = (names, fallback) => {
  const i = argv.findIndex((a) => names.includes(a));
  return i >= 0 ? argv[i + 1] : fallback;
};

if (argv.includes('--list')) {
  for (const key of ['cards', 'worlds', 'motions', 'constraints']) {
    console.log(`\n${key}:`);
    for (const x of pools[key]) console.log(`  ${x.id.padEnd(22)} ${x.name}`);
  }
  process.exit(0);
}

const count = Math.max(1, Number(opt(['-n', '--count'], 1)));
const seed = Number(opt(['-s', '--seed'], Date.now() % 2 ** 31));

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seed);

// 洗牌后依次取，保证同一次里不重复；用完了再洗一遍
const decks = {};
function draw(key) {
  const pool = pools[key];
  if (!decks[key] || decks[key].length === 0) {
    decks[key] = pool.map((_, i) => i);
    for (let i = decks[key].length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [decks[key][i], decks[key][j]] = [decks[key][j], decks[key][i]];
    }
  }
  return pool[decks[key].pop()];
}
function pinned(key, flag) {
  const id = opt([flag], null);
  if (!id) return null;
  const hit = pools[key].find((x) => x.id === id);
  if (!hit) { console.error(`没有这个 id：${id}（用 --list 查看）`); process.exit(1); }
  return hit;
}

const COMMON = `【通用要求】
1. 只输出一个完整的 HTML 文件（<!doctype html> 开头），CSS 和 JS 全部内联；除 Google Fonts 外不引用任何外部资源，不用框架。
2. <head> 里写 <meta name="hx-component" content="卡片 id"> 和 <meta name="hx-style" content="视觉世界 id">。
3. 接口：实现 window.card.set(props)（可反复调用，只给一部分数据时显示骨架，不闪烁）；用户操作时 document.dispatchEvent(new CustomEvent('hx-action', { detail: { name, params } }))；页面底部放一个“Agent 回传”小条，显示最近一次动作的 JSON。
4. 页面上方放一个“模拟 Agent”的小面板：几个按钮，分别把示例 props 的各个状态（加载、正常、特殊、出错、已操作）喂给 window.card.set。卡片的每种状态都要能切换到。
5. 颜色、圆角、间距、字体都写成 :root 上的 CSS 变量（--hx- 前缀）；做深色和浅色两套，默认跟随系统，也支持 <html data-theme="light|dark">。视觉世界本来的那一套做到最好，另一套保证能用。中文字体配 Noto Sans SC。
6. 质感是重点：材质要真实可信，动效有重量和节奏，不要用普通卡片加阴影加渐变糊弄。有音效时默认静音，必须有开关。
7. 具体的名字、数字、时间都要像真的，贴合上面的场景；不要 lorem ipsum，不要 emoji。
8. 用真的 <button>、<input>、<label>；图标用内联 SVG；文字对比度至少 4.5:1；能用键盘操作，焦点可见；尊重 prefers-reduced-motion（减动效时放慢而不是直接停住）。
9. 卡片是主角，页面本身保持素净；不要紫色渐变，不要左边带彩色竖线的卡片。`;

const out = [];
for (let n = 1; n <= count; n++) {
  const card = pinned('cards', '--card') || draw('cards');
  const world = pinned('worlds', '--world') || draw('worlds');
  const motion = pinned('motions', '--motion') || draw('motions');
  const constraint = pinned('constraints', '--constraint') || draw('constraints');
  const scene = pools.scenes[Math.floor(rand() * pools.scenes.length)];
  out.push(`## ${n} · ${card.name} × ${world.name} × ${motion.name} × ${constraint.name}

\`\`\`text
做一张 AI Agent 画给用户的「${card.name}」（id: ${card.id}）。

场景：${scene}。Agent 正在帮用户处理这个处境里的一件具体的事，这张卡片是它在回答里直接画出来的。如果这个处境和这种卡片不太搭，就在同一个人的处境里找一件合理的、会用到这种卡片的小事。
数据与动作（你来具体设计字段，并编出贴合场景的真实示例）：${card.spec}。
要画出的状态：加载（骨架）、正常、一个特殊情况（比如预警、冲突、异常，由你按场景定）、出错（可重试）、用户操作之后的确认态。

视觉世界：${world.name}。${world.text}
动效：${motion.name}。${motion.text}
额外限制：${constraint.name}。${constraint.text}

${COMMON}
\`\`\``);
}

console.log(`<!-- 种子 ${seed}：node prompts/roll.mjs -n ${count} -s ${seed} 可复现 -->\n`);
console.log(out.join('\n\n'));
