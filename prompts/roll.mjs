#!/usr/bin/env node
// 随机提示词组合器：从 pools.json 里抽「卡片 × 视觉世界 × 动效 × 限制 × 场景」，拼成一条可以直接复制的提示词。
//
// 用法：
//   node prompts/roll.mjs              出 1 条
//   node prompts/roll.mjs -n 6         出 6 条（同一次里卡片和视觉世界不重复）
//   node prompts/roll.mjs -n 6 -s 42   固定种子，结果可复现
//   node prompts/roll.mjs --card flight-card --world split-flap   钉住其中几项，其余随机
//   node prompts/roll.mjs --list       列出所有可钉住的 id（卡片后面带它适合的 harness）
//   node prompts/roll.mjs --harness 法律审查   只从适合这类 harness 的卡片里抽
//   node prompts/roll.mjs --form sidebar      只抽侧边栏组件（card 是回答里的卡片，sidebar 是常驻在工作台一侧的面板）
//   node prompts/roll.mjs --whole             抽一整套 harness：行业 × 布局 × 视觉世界 × 动效，连同它该有的组件一起做成一整个工作台
//   node prompts/roll.mjs --whole --harness legal-review --layout three-pane   钉住其中几项

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
  for (const key of ['cards', 'worlds', 'motions', 'constraints', 'harnesses', 'layouts']) {
    console.log(`\n${key}:`);
    for (const x of pools[key]) console.log(`  ${x.id.padEnd(22)} ${x.name}${x.form === 'sidebar' ? '［侧边栏］' : ''}${x.harness ? '  → ' + x.harness.join('、') : ''}`);
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

// --harness 关键字：只从适合这类 harness 的卡片里抽（匹配任意一个标注，包含即可）
const wanted = opt(['--harness'], null);
if (wanted && !argv.includes('--whole')) {
  pools.cards = pools.cards.filter((c) => c.harness.some((h) => h.includes(wanted)));
  if (!pools.cards.length) { console.error(`没有卡片标注了“${wanted}”（用 --list 查看）`); process.exit(1); }
}

// --form card|sidebar：只抽这种形态的组件（没写 form 的都算 card）
const form = opt(['--form'], null);
if (form) {
  pools.cards = pools.cards.filter((c) => (c.form || 'card') === form);
  if (!pools.cards.length) { console.error(`没有 form 为“${form}”的组件（可选 card、sidebar）`); process.exit(1); }
}

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

const common = (what) => `【通用要求】
1. 只输出一个完整的 HTML 文件（<!doctype html> 开头），CSS 和 JS 全部内联；除 Google Fonts 外不引用任何外部资源，不用框架。
2. <head> 里写 <meta name="hx-component" content="卡片 id">、<meta name="hx-style" content="视觉世界 id"> 和 <meta name="hx-harness" content="适合的 harness，用顿号分隔">；页面标题下面再用一行小字写出“适合的 harness：……”。
3. 接口：实现 window.card.set(props)（可反复调用，只给一部分数据时显示骨架，不闪烁）；用户操作时 document.dispatchEvent(new CustomEvent('hx-action', { detail: { name, params } }))；页面底部放一个“Agent 回传”小条，显示最近一次动作的 JSON。
4. 页面上方放一个“模拟 Agent”的小面板：几个按钮，分别把示例 props 的各个状态（加载、正常、特殊、出错、已操作）喂给 window.card.set。${what}的每种状态都要能切换到。
5. 颜色、圆角、间距、字体都写成 :root 上的 CSS 变量（--hx- 前缀）；做深色和浅色两套，默认跟随系统，也支持 <html data-theme="light|dark">。视觉世界本来的那一套做到最好，另一套保证能用。中文字体配 Noto Sans SC。
6. 质感是重点：材质要真实可信，动效有重量和节奏，不要用普通卡片加阴影加渐变糊弄。有音效时默认静音，必须有开关。
7. 具体的名字、数字、时间都要像真的，贴合上面的场景；不要 lorem ipsum，不要 emoji。
8. 用真的 <button>、<input>、<label>；图标用内联 SVG；文字对比度至少 4.5:1；能用键盘操作，焦点可见；尊重 prefers-reduced-motion（减动效时放慢而不是直接停住）。
9. ${what}是主角，页面本身保持素净；不要紫色渐变，不要左边带彩色竖线的卡片。`;

// ---------- 整套 harness ----------
const WHOLE = `【整套的要求】
1. 只输出一个完整的 HTML 文件（<!doctype html> 开头），CSS 和 JS 全部内联；除 Google Fonts 外不引用任何外部资源，不用框架。
2. <head> 里写 <meta name="hx-component" content="harness id">、<meta name="hx-form" content="whole">、<meta name="hx-style" content="视觉世界 id">、<meta name="hx-harness" content="harness 名">；页面标题下面用一行小字写“适合的 harness：……”。
3. 接口：window.harness.set(state) 可以整体喂，也可以只喂某一块（比如只更新任务、只追加一条消息）；用户的每个操作都 document.dispatchEvent(new CustomEvent('hx-action', { detail: { name, params, part } }))，part 是发生在哪个组件；页面最下面放“Agent 回传”小条，显示最近一次动作的 JSON。
4. 工作台上方（或下方）放“模拟 Agent”面板：能切到刚打开（加载）、做到一半、等用户确认（风险最高的那一步）、出错、做完之后的确认态；再加一个“演一遍”按钮，按真实的节奏把整个流程自动走一遍。
5. 组件之间要联动，这是整套和单个组件最大的不同：在侧边栏点一个对象，对话和右侧面板跟着定位；用户批准一步，计划清单打勾、进度和费用跟着变；拒绝或撤回，相关的地方都退回去。
6. 布局要真的能用：宽屏是完整布局；窄屏（< 960px）把侧边的东西收进抽屉；手机（< 600px）变成单栏，组件按时间顺序排进对话里。
7. 颜色、圆角、间距、字体写成 :root 上的 --hx- 变量，深浅两套，默认跟随系统，也支持 <html data-theme="light|dark">。中文字体配 Noto Sans SC。
8. 整套只用这一个视觉世界，所有组件看起来属于同一个产品；风险越高，确认类的地方越要清楚、克制，不玩花样。
9. 名字、数字、时间都要像真的，贴合场景；不要 lorem ipsum，不要 emoji，不要紫色渐变，不要左边带彩色竖线的卡片。
10. 用真的 <button>、<input>、<label>；图标用内联 SVG；文字对比度至少 4.5:1；全程能用键盘操作，焦点可见；尊重 prefers-reduced-motion。`;

if (argv.includes('--whole')) {
  const H = pools.harnesses, LAY = pools.layouts;
  const pick = (list, flag) => { const id = opt([flag], null); if (!id) return null; const hit = list.find((x) => x.id === id || x.name.includes(id)); if (!hit) { console.error(`没有这个 id：${id}（用 --list 查看）`); process.exit(1); } return hit; };
  const TOY = (w) => /^toy-|clay-toy|handheld-console/.test(w.id);
  const out = [];
  for (let n = 1; n <= count; n++) {
    const h = pick(H, '--harness') || H[Math.floor(rand() * H.length)];
    const layout = pick(LAY, '--layout') || LAY[Math.floor(rand() * LAY.length)];
    const risky = /^(高|很高)/.test(h.risk);
    // 高风险的 harness 不抽玩具皮肤
    let world = pinned('worlds', '--world') || draw('worlds');
    while (risky && TOY(world) && !opt(['--world'], null)) world = draw('worlds');
    const motion = pinned('motions', '--motion') || draw('motions');
    let constraint = pinned('constraints', '--constraint') || draw('constraints');
    while (['widget', 'no-text', 'one-hand'].includes(constraint.id) && !opt(['--constraint'], null)) constraint = draw('constraints');
    const parts = h.parts.map((id) => pools.cards.find((c) => c.id === id)).filter(Boolean)
      .map((c) => `- ${c.name}${c.form === 'sidebar' ? '［侧边栏］' : ''}（${c.id}）：${c.spec}`).join('\n');
    out.push(`## ${n} · ${h.name}（整套） × ${layout.name} × ${world.name} × ${motion.name} × ${constraint.name}

**适合的 harness：${h.name.replace(/ harness$/, '')}**　谁在用：${h.who}　风险：${h.risk}

\`\`\`text
做一整套 AI Agent 工作台（harness）的界面：「${h.name}」（id: ${h.id}）。不是单个组件，而是用户每天打开、在里面和 Agent 一起把事做完的整个工作台。

谁在用：${h.who}。
它要做的事：${h.job}。
风险：${h.risk}。
场景：${h.scene}。页面展示这件事做到一半的样子：Agent 已经开始干活，有些地方在等用户点头。

布局：${layout.name}。${layout.text}
要包含的组件（都要真的能用，并且互相联动）：
${parts}
另外，顶部或角落要能看到运行状态（在做什么、做到哪、花了多少）。

视觉世界：${world.name}。${world.text}
动效：${motion.name}。${motion.text}
额外限制：${constraint.name}。${constraint.text}

${WHOLE}
\`\`\``);
  }
  console.log(`<!-- 种子 ${seed}：node prompts/roll.mjs --whole -n ${count} -s ${seed} 可复现 -->\n`);
  console.log(out.join('\n\n'));
  process.exit(0);
}

const out = [];
for (let n = 1; n <= count; n++) {
  const card = pinned('cards', '--card') || draw('cards');
  const world = pinned('worlds', '--world') || draw('worlds');
  const motion = pinned('motions', '--motion') || draw('motions');
  let constraint = pinned('constraints', '--constraint') || draw('constraints');
  // 侧边栏是竖长、占满高度的面板，和“小组件尺寸”矛盾，抽到就换一个
  while (card.form === 'sidebar' && constraint.id === 'widget' && !opt(['--constraint'], null)) constraint = draw('constraints');
  const scene = pools.scenes[Math.floor(rand() * pools.scenes.length)];
  const fit = card.harness.join('、');
  const side = card.form === 'sidebar';
  const intro = side
    ? `做一个 AI Agent 工作台侧边栏里的「${card.name}」面板（id: ${card.id}）。适合用在这些 harness 里：${fit}。`
    : `做一张 AI Agent 画给用户的「${card.name}」（id: ${card.id}）。适合用在这些 harness 里：${fit}。`;
  const where = side
    ? '这个面板常驻在 harness 界面的一侧，Agent 工作的时候它跟着实时更新，用户随时瞄一眼、点一下'
    : '这张卡片是它在回答里直接画出来的';
  const states = side
    ? '加载（骨架）、正常、一个特殊情况（比如预警、冲突、异常，由你按场景定）、出错（可重试）、用户操作之后的确认态，以及收起成窄条（只剩图标或数字）的样子。'
    : '加载（骨架）、正常、一个特殊情况（比如预警、冲突、异常，由你按场景定）、出错（可重试）、用户操作之后的确认态。';
  const shape = side
    ? '\n形态：竖长的面板，宽 280–340px、高度占满（页面上演示时给它一个 640px 左右的高度），旁边用一块浅浅的占位示意主对话区；内容多了在面板内部滚动，标题和底部操作固定；能收起成 56px 左右的窄条，再展开。'
    : '';
  out.push(`## ${n} · ${card.name}${side ? '（侧边栏）' : ''} × ${world.name} × ${motion.name} × ${constraint.name}

**适合的 harness：${fit}**

\`\`\`text
${intro}

场景：${scene}。Agent 正在帮用户处理这个处境里的一件具体的事，${where}。如果这个处境和这种${side ? '面板' : '卡片'}不太搭，就在同一个人的处境里找一件合理的、会用到它的小事。
数据与动作（你来具体设计字段，并编出贴合场景的真实示例）：${card.spec}。
要画出的状态：${states}${shape}

视觉世界：${world.name}。${world.text}
动效：${motion.name}。${motion.text}
额外限制：${constraint.name}。${constraint.text}

${common(side ? '面板' : '卡片')}
\`\`\``);
}

console.log(`<!-- 种子 ${seed}：node prompts/roll.mjs -n ${count} -s ${seed} 可复现 -->\n`);
console.log(out.join('\n\n'));
