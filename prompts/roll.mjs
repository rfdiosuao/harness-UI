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
//   node prompts/roll.mjs --minimal           视觉世界只抽极简的（单件和整套都能用）
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
  console.log('\nskeleton（每套整套 harness 都必须有）:');
  for (const k of pools.skeleton || []) console.log(`  ${k.id.padEnd(22)} ${k.name}  → ${k.cards.join('、')}`);
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

// --minimal：视觉世界只从极简的几种里抽（极简单线、极简字排、极简几何、极简夜玻璃）
// 极简只是一种风格：它只决定长什么样，功能、骨架、行业组件一样都不能少
if (argv.includes('--minimal')) {
  pools.worlds = pools.worlds.filter((w) => w.id.startsWith('min-'))
    .map((w) => ({ ...w, text: w.text + '注意：极简只是外观风格，不是功能简化——该有的组件、状态、操作和联动一样都不能少，只是用更少的视觉元素把它们表达清楚。' }));
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

// ---------- 第一性原理：UI 按金字塔原理排信息，动效按迪士尼动画 12 原则来做；单件和整套都要遵守 ----------
const PRINCIPLES = `【第一性原理】先想清楚这两条，再动手画；视觉世界和动效池里的写法都要服从它们。
一、UI 用金字塔原理组织信息
1. 结论先行：每个区域、每张卡片最上面一眼看到的，是“现在怎么样 / 要你做什么”的一句话结论，金额、状态、截止时间这类关键数字跟在结论里；细节往下或折叠起来。
2. 以上统下：标题和分组名要能概括下面的内容；下面的每一项都在支撑上面那句结论，和结论无关的东西删掉。
3. 归类分组：同一层的东西不重不漏地分组（彼此独立、合起来完整），一组不超过 7 项。
4. 逻辑递进：同一组按一种顺序排——时间顺序、重要程度或结构顺序，选定一种就不混用。
5. 视觉层级跟着信息层级走：越靠近结论的越大、越重、越先出现；一屏只有一个主要动作，次要动作明显更弱。
二、动效用迪士尼动画 12 原则
1. 时间节奏（timing）：小东西快（按钮、勾选 100–180ms），大东西慢（面板、页面 280–480ms）；重的东西动得慢、停得稳。
2. 缓入缓出（slow in / slow out）：不用线性动画；起步和停下都有加减速。
3. 预备动作（anticipation）：重要变化前先给一点提示（按下前微微下沉、面板展开前先轻收一下、出错前先停半拍）。
4. 挤压与拉伸（squash & stretch）：可以按的东西按下有质量感、松开有回弹；幅度克制，文字本身不变形。
5. 跟随与重叠（follow through & overlapping）：一组东西错开 30–60ms 依次到位，主体先停、附属的后停，不要整块一起蹦出来。
6. 弧线运动（arcs）：东西从一处移到另一处（拖拽、飞入、收进侧栏）走弧线，不走死板的直线。
7. 演出（staging）：同一时刻只有一个焦点在动，用动效把视线带到用户该看的地方；动效的先后顺序就是金字塔的顺序——先动结论，再动细节。
8. 次要动作（secondary action）：可以有辅助的小动作衬托主动作，但不能抢戏。
9. 夸张（exaggeration）：只在关键时刻（完成、付款成功、出错）适度夸张一次，其余时候安静。
10. 立体感与吸引力（solid drawing & appeal）：东西看起来有体积、有重量、讨人喜欢，而不是平面色块在滑。
11. 姿态到姿态（pose to pose）：每个状态先设计好静止时的样子，动效只是两个好看的静止状态之间的过渡；静止截图也要好看。
12. 减动效（prefers-reduced-motion）时保留顺序和层级，放慢或改成淡入淡出，不要直接全停。`;

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
5. 对话永远是主体：不管哪种布局，宽屏时对话流占最大的面积（或居中），不能收进角落、浮窗或某一列里；侧边栏和面板都能收起，全部收起后只剩对话也照样能把事办完。行业组件需要用户处理时，要出现在对话里（作为消息里的卡片），面板上只放它的同步状态。
6. 组件之间要联动，这是整套和单个组件最大的不同：在侧边栏点一个对象，对话和右侧面板跟着定位；用户批准一步，计划清单打勾、进度和费用跟着变；拒绝或撤回，相关的地方都退回去。
7. 布局要真的能用：宽屏是完整布局；窄屏（< 960px）把侧边的东西收进抽屉；手机（< 600px）变成单栏，组件按时间顺序排进对话里。
8. 颜色、圆角、间距、字体写成 :root 上的 --hx- 变量，深浅两套，默认跟随系统，也支持 <html data-theme="light|dark">。中文字体配 Noto Sans SC。
9. 整套只用这一个视觉世界，所有组件看起来属于同一个产品。视觉世界只管外观，不改变骨架：对话还是对话、输入框还是输入框、按钮还是按钮，用户第一眼就知道怎么用。风险越高，确认类的地方越要清楚、克制，不玩花样。
10. 名字、数字、时间都要像真的，贴合场景；不要 lorem ipsum，不要 emoji，不要紫色渐变，不要左边带彩色竖线的卡片。
11. 用真的 <button>、<input>、<label>；图标用内联 SVG；文字对比度至少 4.5:1；全程能用键盘操作，焦点可见；尊重 prefers-reduced-motion。`;

if (argv.includes('--whole')) {
  const H = pools.harnesses, LAY = pools.layouts, SKEL = pools.skeleton || [];
  // 布局只决定附加面板放哪，对话必须留在主体位置：写布局时漏了“对话”就直接报错
  for (const l of LAY) if (!l.text.includes('对话')) { console.error(`布局 ${l.id} 没写对话放在哪；整套 harness 的布局必须以对话为主体`); process.exit(1); }
  const pick = (list, flag) => { const id = opt([flag], null); if (!id) return null; const hit = list.find((x) => x.id === id || x.name.includes(id)); if (!hit) { console.error(`没有这个 id：${id}（用 --list 查看）`); process.exit(1); } return hit; };
  const TOY = (w) => /^toy-|clay-toy|handheld-console/.test(w.id);
  const out = [];
  for (let n = 1; n <= count; n++) {
    const h = pick(H, '--harness') || H[Math.floor(rand() * H.length)];
    // 有的布局只适合特定的 harness（比如群聊只给多人协作的），随机时只从适合这个 harness 的布局里抽
    const fitLay = LAY.filter((l) => !l.only || l.only.includes(h.id));
    const layout = pick(LAY, '--layout') || fitLay[Math.floor(rand() * fitLay.length)];
    const risky = /^(高|很高)/.test(h.risk);
    // 高风险的 harness 不抽玩具皮肤
    let world = pinned('worlds', '--world') || draw('worlds');
    while (risky && TOY(world) && !opt(['--world'], null)) world = draw('worlds');
    const motion = pinned('motions', '--motion') || draw('motions');
    let constraint = pinned('constraints', '--constraint') || draw('constraints');
    while (['widget', 'no-text', 'one-hand'].includes(constraint.id) && !opt(['--constraint'], null)) constraint = draw('constraints');
    // 骨架：每套都必须有；行业组件：这类 harness 特有的，去掉和骨架重复的
    const skeletonIds = new Set(SKEL.flatMap((k) => k.cards));
    const skeleton = SKEL.map((k, i) => `${i + 1}. ${k.name}：${k.need}。（参考组件：${k.cards.map((id) => { const c = pools.cards.find((x) => x.id === id); return c ? c.name : id; }).join('、')}）`).join('\n');
    const parts = h.parts.filter((id) => !skeletonIds.has(id)).map((id) => pools.cards.find((c) => c.id === id)).filter(Boolean)
      .map((c) => `- ${c.name}${c.form === 'sidebar' ? '［侧边栏］' : ''}（${c.id}）：${c.spec}`).join('\n');
    out.push(`## ${n} · ${h.name}（整套） × ${layout.name} × ${world.name} × ${motion.name} × ${constraint.name}

**适合的 harness：${h.name.replace(/ harness$/, '')}**　谁在用：${h.who}　风险：${h.risk}

\`\`\`text
做一整套 AI Agent 工作台（harness）的界面：「${h.name}」（id: ${h.id}）。不是单个组件，而是用户每天打开、在里面和 Agent 一起把事做完的整个工作台。

谁在用：${h.who}。
它要做的事：${h.job}。
风险：${h.risk}。
场景：${h.scene}。页面展示这件事做到一半的样子：Agent 已经开始干活，有些地方在等用户点头。

【骨架】每一套 harness 都必须有这 ${SKEL.length} 样，缺一样就不算 harness（外观随视觉世界变，功能不能少）：
${skeleton}

【行业组件】这类 harness 特有的（都要真的能用，并且和骨架联动）：
${parts}

布局：${layout.name}。${layout.text}

视觉世界：${world.name}。${world.text}
动效：${motion.name}。${motion.text}
额外限制：${constraint.name}。${constraint.text}

${WHOLE}

${PRINCIPLES}
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

${PRINCIPLES}
\`\`\``);
}

console.log(`<!-- 种子 ${seed}：node prompts/roll.mjs -n ${count} -s ${seed} 可复现 -->\n`);
console.log(out.join('\n\n'));
