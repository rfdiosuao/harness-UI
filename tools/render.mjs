#!/usr/bin/env node
// 把设计画布格式（.dc.html）导出成浏览器能直接打开的静态 HTML。
//
// 用法：node tools/render.mjs
//   读取 source/ 里的三个设计稿，写到 designs/ 下。
//   A 方向的权限按钮在画布里能点；静态页没有脚本，所以把点完之后的三种状态各导出一页。
//
// 这里只实现了三个设计稿用到的模板规则：
//   {{a.b}}               按路径取值（不支持表达式）
//   <sc-for list as>      重复，循环里能用 {{item.x}} 和 {{$index}}
//   <sc-if value>         条件
//   onClick="{{fn}}"      事件绑定，静态页里去掉
//   data-props 里每项的 default 作为 this.props，renderVals() 的返回值就是模板的数据。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const JOBS = [
  { src: 'source/Main.dc.html', out: 'designs/a-console/index.html' },
  { src: 'source/Main.dc.html', out: 'designs/a-console/allow.html', state: { decision: 'allow' } },
  { src: 'source/Main.dc.html', out: 'designs/a-console/readonly.html', state: { decision: 'readonly' } },
  { src: 'source/Main.dc.html', out: 'designs/a-console/deny.html', state: { decision: 'deny' } },
  { src: 'source/Ledger.dc.html', out: 'designs/b-ledger/index.html' },
  { src: 'source/Recorder.dc.html', out: 'designs/c-recorder/index.html' },
];

const unescapeAttr = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escapeHtml = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parse(src) {
  const pick = (re) => (re.exec(src) || [])[1] || '';
  const script = /<script type="text\/x-dc" data-dc-script data-props='([^']*)'>([\s\S]*?)<\/script>/.exec(src);
  if (!script) throw new Error('没找到 <script type="text/x-dc" data-dc-script>');
  return {
    lang: pick(/<html lang="([^"]+)"/) || 'en',
    title: pick(/<title>([\s\S]*?)<\/title>/),
    helmet: pick(/<helmet>([\s\S]*?)<\/helmet>/).trim(),
    template: pick(/<x-dc>([\s\S]*?)<\/x-dc>/).replace(/<helmet>[\s\S]*?<\/helmet>/, ''),
    props: JSON.parse(unescapeAttr(script[1])),
    code: script[2],
  };
}

function renderVals(code, propDefs, state) {
  const props = {};
  for (const [key, def] of Object.entries(propDefs)) {
    if (!key.startsWith('$') && def && 'default' in def) props[key] = def.default;
  }
  const ctx = vm.createContext({ console });
  vm.runInContext(
    'class DCLogic { constructor(props) { this.props = props; this.state = null; }' +
      ' setState(s) { this.state = Object.assign({}, this.state, s); } forceUpdate() {} }\n' +
      code +
      '\nglobalThis.__Component = Component;',
    ctx,
  );
  const component = new ctx.__Component(props);
  if (state) component.state = state;
  return component.renderVals();
}

function lookup(scope, expr) {
  const e = expr.trim();
  if (e === 'true') return true;
  if (e === 'false') return false;
  if (e === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
  const quoted = /^(['"])(.*)\1$/.exec(e);
  if (quoted) return quoted[2];
  let v = scope;
  for (const key of e.split('.')) {
    if (v == null) return undefined;
    v = v[key];
  }
  return v;
}

function wholeHole(raw, scope) {
  const m = /^\s*\{\{([^{}]+)\}\}\s*$/.exec(raw || '');
  return m ? lookup(scope, m[1]) : raw;
}

function fill(html, scope) {
  return html
    .replace(/\s+on[A-Z][A-Za-z]*="\{\{[^{}]*\}\}"/g, '')
    .replace(/\{\{([^{}]+)\}\}/g, (_, e) => {
      const v = lookup(scope, e);
      return v == null || typeof v === 'function' ? '' : escapeHtml(v);
    });
}

function render(tpl, scope) {
  let out = '';
  let i = 0;
  const open = /<sc-(for|if)\b([^>]*)>/g;
  for (;;) {
    open.lastIndex = i;
    const m = open.exec(tpl);
    if (!m) return out + fill(tpl.slice(i), scope);
    out += fill(tpl.slice(i, m.index), scope);
    const tag = 'sc-' + m[1];
    const pair = new RegExp('<' + tag + '\\b[^>]*>|</' + tag + '>', 'g');
    pair.lastIndex = open.lastIndex;
    let depth = 1;
    let close;
    while ((close = pair.exec(tpl))) {
      if (close[0].startsWith('</')) {
        if (--depth === 0) break;
      } else {
        depth += 1;
      }
    }
    if (!close) throw new Error('<' + tag + '> 没有闭合');
    const inner = tpl.slice(open.lastIndex, close.index);
    i = close.index + close[0].length;
    const attrs = Object.fromEntries([...m[2].matchAll(/([\w$-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    if (m[1] === 'if') {
      if (wholeHole(attrs.value, scope)) out += render(inner, scope);
    } else {
      const list = wholeHole(attrs.list, scope) || [];
      list.forEach((item, index) => {
        const child = Object.create(scope);
        child[attrs.as || 'item'] = item;
        child.$index = index;
        out += render(inner, child);
      });
    }
  }
}

function exportPage({ src, out, state }) {
  const d = parse(fs.readFileSync(path.join(ROOT, src), 'utf8'));
  const body = render(d.template, renderVals(d.code, d.props, state)).replace(/\n\s*\n(\s*\n)+/g, '\n\n').trim();
  const note = state ? `，状态 ${JSON.stringify(state)}` : '';
  const html = `<!doctype html>
<html lang="${d.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${d.title}</title>
<!-- 由 tools/render.mjs 从 ${src} 导出${note}。要改设计请改源文件，再重新导出。 -->
${d.helmet}
</head>
<body>
${body}
</body>
</html>
`;
  fs.mkdirSync(path.dirname(path.join(ROOT, out)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, out), html);
  return html.length;
}

for (const job of JOBS) {
  const size = exportPage(job);
  console.log(`${job.out}  ${(size / 1024).toFixed(1)} KB`);
}
