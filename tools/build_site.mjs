#!/usr/bin/env node
// 生成陈列馆网站的目录数据 site-data.js（被 index.html 读取）。
//
// 用法：node tools/build_site.mjs
//   每个组件的名称、视觉世界、适合的 harness、说明，都从组件页自己的 <title>、<meta> 和标题下第一段文字里读；
//   动效和限制从 components/INDEX.md 的表格里读；展品编号按 INDEX.md 的顺序排。
//   新做一个组件：放进 components/，在 INDEX.md 补一行，再跑一次这个脚本。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMP = path.join(ROOT, 'components');

// 视觉世界 → 风格家族（陈列馆里的筛选项）
const FAMILY = {
  'min-monoline': '极简', 'min-type': '极简', 'min-geometry': '极简',
  'toy-slot': '玩具', 'toy-gacha': '玩具', 'toy-pinball': '玩具', 'toy-bubblewrap': '玩具', 'clay-toy': '玩具', 'handheld-console': '玩具',
  'graph-paper': '规整', 'swiss-grid': '规整', 'metro-map': '规整', 'punch-card': '规整',
};
const famOf = (style) => FAMILY[style] || '实物';
// 160×160 这样的小组件，缩略图里放大一些才看得清
// 侧边栏连着主对话区占位，有 640px 高，缩略图里缩小一点才放得下
const ZOOM = { 'transfer-confirm--sea-chart': 2, 'subscription-list--min-type': 2, 'file-tree--toy-bubblewrap': 0.8, 'task-queue--min-type': 0.8 };

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const cell = (s) => strip(s.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));

// INDEX.md：| [文件](文件) | 卡片 | 视觉世界 | 动效 | 限制 | 适合的 harness |
const index = fs.readFileSync(path.join(COMP, 'INDEX.md'), 'utf8');
const rows = [];
for (const line of index.split('\n')) {
  const m = /^\|\s*\[([^\]]+\.html)\]/.exec(line);
  if (!m) continue;
  const cols = line.split('|').slice(1, -1).map((c) => c.trim());
  rows.push({ file: m[1], motion: cell(cols[3] || ''), constraint: cell(cols[4] || '') });
}

const pools = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/pools.json'), 'utf8'));
const formOf = (cid) => ((pools.cards.find((c) => c.id === cid) || {}).form === 'sidebar' ? '侧边栏' : '卡片');

const items = rows.map((r, i) => {
  const html = fs.readFileSync(path.join(COMP, r.file), 'utf8');
  const meta = (name) => ((new RegExp('<meta name="' + name + '" content="([^"]*)"')).exec(html) || [])[1] || '';
  const title = strip((/<title>([\s\S]*?)<\/title>/.exec(html) || [])[1] || r.file);
  const [name, world] = title.split(' · ');
  const head = (/<header class="head">([\s\S]*?)<\/header>/.exec(html) || [])[1] || '';
  const ps = [...head.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => strip(m[1]));
  const desc = ps.find((p) => !p.startsWith('适合的 harness')) || '';
  const fit = (ps.find((p) => p.startsWith('适合的 harness')) || '').replace(/^适合的 harness：/, '');
  const id = r.file.replace(/\.html$/, '');
  const style = meta('hx-style');
  return {
    no: 'HX-' + String(i + 1).padStart(2, '0'),
    id, file: 'components/' + r.file,
    name: name || title, world: world || style,
    component: meta('hx-component'), form: formOf(meta('hx-component')), style, family: famOf(style),
    harness: meta('hx-harness').split('、').map((s) => s.trim()).filter(Boolean),
    fit, desc, motion: r.motion, constraint: r.constraint,
    zoom: ZOOM[id] || 1,
  };
});

// 卡池的规模，展示在首页
const stats = {
  exhibits: items.length,
  cards: pools.cards.length,
  worlds: pools.worlds.length,
  motions: pools.motions.length,
  constraints: pools.constraints.length,
  scenes: (pools.scenes || []).length,
  core: pools.cards.filter((c) => (c.harness || []).includes('通用核心')).map((c) => ({ id: c.id, name: c.name })),
};

const out = '/* 由 tools/build_site.mjs 生成，不要手改。 */\nwindow.HX_SITE = ' + JSON.stringify({ items, stats }, null, 2) + ';\n';
fs.writeFileSync(path.join(ROOT, 'site-data.js'), out);
console.log(`site-data.js: ${items.length} 件展品；卡池 ${stats.cards} 种卡片（通用核心 ${stats.core.length}）、${stats.worlds} 个视觉世界、${stats.motions} 种动效`);
for (const it of items) console.log(`  ${it.no}  ${it.name} · ${it.world} · ${it.form} · ${it.family} → ${it.harness.join('、')}`);
