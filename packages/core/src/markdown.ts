/**
 * Streaming Markdown repair.
 *
 * A model streams Markdown a few characters at a time, so most frames end
 * mid-syntax: `**bo`, `` `npm ru ``, `[docs](https://ex`, or an unclosed
 * code fence. Rendered as-is, those flash raw markers and then snap into
 * place when the closer arrives.
 *
 * `repairMarkdown` closes (or, if nothing follows them yet, removes) the
 * constructs the end of the text leaves open, so every frame renders the
 * way the finished text will. It only looks at the tail of the document:
 * earlier blocks are already final. Pure string in, string out, no
 * dependencies.
 *
 * Deliberately not handled: `_` / `__` emphasis (too easily confused with
 * snake_case identifiers), raw HTML, and tables whose delimiter row has not
 * arrived yet.
 */
export function repairMarkdown(text: string): string {
  const fences = scanFences(text);
  if (fences.open) {
    // Everything after an open fence is code; just close it. A last line that
    // is the start of the closing fence ("`", "``") isn't content: drop it.
    const fence = fences.open;
    const lastLineStart = text.lastIndexOf('\n') + 1;
    const lastLine = text.slice(lastLineStart);
    const partialCloser =
      lastLineStart > fences.openLineStart && /^ {0,3}([`~])\1*$/.test(lastLine) && lastLine.trim()[0] === fence[0];
    const body = partialCloser ? text.slice(0, lastLineStart) : text;
    return `${body}${body.endsWith('\n') ? '' : '\n'}${fence}`;
  }
  const start = Math.max(lastBlankLineEnd(text), fences.lastCloseEnd);
  const segmentStart = inlineSegmentStart(text, start);
  return text.slice(0, segmentStart) + repairInline(text.slice(segmentStart));
}

// ---------------------------------------------------------------------------
// Block level
// ---------------------------------------------------------------------------

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

function scanFences(text: string): { open: string | null; openLineStart: number; lastCloseEnd: number } {
  let open: { char: string; len: number; lineStart: number } | null = null;
  let lastCloseEnd = 0;
  let offset = 0;
  for (const line of text.split('\n')) {
    const end = offset + line.length + 1;
    if (!open) {
      const m = FENCE_OPEN.exec(line);
      // A backtick fence's info string may not contain backticks.
      if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) open = { char: m[1]![0]!, len: m[1]!.length, lineStart: offset };
    } else {
      const m = FENCE_CLOSE.exec(line);
      if (m && m[1]![0] === open.char && m[1]!.length >= open.len) {
        open = null;
        lastCloseEnd = Math.min(end, text.length);
      }
    }
    offset = end;
  }
  return { open: open ? open.char.repeat(open.len) : null, openLineStart: open?.lineStart ?? -1, lastCloseEnd };
}

function lastBlankLineEnd(text: string): number {
  let end = 0;
  for (const m of text.matchAll(/\n[ \t]*\n/g)) end = m.index + m[0].length;
  return end;
}

/** In lists, tables, quotes and headings, inline syntax never spans lines. */
const LINE_SCOPED = /^ {0,3}(?:[-+*]\s|\d{1,9}[.)]\s|\||>|#{1,6}\s)/;

function inlineSegmentStart(text: string, blockStart: number): number {
  const lastLineStart = text.lastIndexOf('\n') + 1;
  if (lastLineStart <= blockStart) return blockStart;
  return LINE_SCOPED.test(text.slice(lastLineStart)) ? lastLineStart : blockStart;
}

// ---------------------------------------------------------------------------
// Inline level
// ---------------------------------------------------------------------------

function repairInline(s: string): string {
  const code = findOpenCodeSpan(s);
  if (code) {
    const before = s.slice(0, code.start);
    // Nothing typed inside the span yet: drop the opener.
    if (code.start + code.len === s.length) return repairInline(before);
    const stack = scanEmphasis(mask(before));
    return s + '`'.repeat(code.len) + closers(stack);
  }

  let out = repairTrailingLink(s);
  const stack = scanEmphasis(mask(out));
  // Half of a `~~` closer: "~~the~".
  if (stack[stack.length - 1]?.marker === '~~' && /[^~]~$/.test(out)) out = out.slice(0, -1);
  // An opener with nothing after it yet is removed rather than closed, so
  // "Hello **" renders as "Hello" instead of literal asterisks.
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (out.slice(top.index + top.marker.length).trim() !== '') break;
    out = out.slice(0, top.index) + out.slice(top.index + top.marker.length);
    stack.pop();
  }
  // A closer must touch the text it closes.
  return stack.length > 0 ? out.trimEnd() + closers(stack) : out;
}

function closers(stack: Opener[]): string {
  return stack
    .map((o) => o.marker)
    .reverse()
    .join('');
}

function findOpenCodeSpan(s: string): { start: number; len: number } | null {
  let open: { start: number; len: number } | null = null;
  for (const m of s.matchAll(/(?<!\\)`+/g)) {
    const len = m[0].length;
    if (!open) open = { start: m.index, len };
    else if (len === open.len) open = null;
  }
  return open;
}

/**
 * `[label` → `label`, `[label](https://ex` → `label`, and a half-written
 * image is dropped. A complete `[label]` is left alone: it may be literal.
 */
function repairTrailingLink(s: string): string {
  const m = /(!?)\[([^[\]\n]*)(?:\]\(([^)\n]*))?$/.exec(s);
  if (!m) return s;
  const [whole, bang, label] = m;
  const isOpenBracket = !whole.includes('](');
  if (bang) return s.slice(0, m.index);
  if (isOpenBracket || m[3] !== undefined) return s.slice(0, m.index) + label;
  return s;
}

/**
 * Hide escapes, code spans and link destinations from the emphasis scan,
 * preserving offsets. The filler is a non-space character on purpose: in
 * `` **`code`** `` the `**` must still look like it touches text.
 */
function mask(s: string): string {
  const blank = (x: string) => 'x'.repeat(x.length);
  return s
    .replace(/\\./g, blank)
    .replace(/(`+)[\s\S]*?\1/g, blank)
    .replace(/\]\([^)]*\)/g, (x) => `]${blank(x.slice(1))}`)
    .replace(/<https?:[^>\s]*>|https?:\/\/\S+/g, blank);
}

interface Opener {
  marker: '*' | '**' | '~~';
  index: number;
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/** Returns the emphasis openers still unclosed at the end of `s`. */
function scanEmphasis(s: string): Opener[] {
  const stack: Opener[] = [];
  for (const m of s.matchAll(/\*+|~~/g)) {
    const run = m[0];
    const prev = s[m.index - 1];
    const next = s[m.index + run.length];
    // At the very end of the text the next character just hasn't arrived.
    const canOpen = next === undefined || !isSpace(next);
    const canClose = !isSpace(prev);

    if (run === '~~') {
      const top = stack[stack.length - 1];
      if (canClose && top?.marker === '~~') stack.pop();
      else if (canOpen) stack.push({ marker: '~~', index: m.index });
      continue;
    }

    let remaining = run.length;
    while (remaining > 0) {
      const top = stack[stack.length - 1];
      const at = m.index + run.length - remaining;
      if (canClose && top?.marker === '**' && remaining >= 2) {
        stack.pop();
        remaining -= 2;
      } else if (canClose && top?.marker === '*') {
        stack.pop();
        remaining -= 1;
      } else if (canOpen) {
        const marker = remaining >= 2 ? '**' : '*';
        stack.push({ marker, index: at });
        remaining -= marker.length;
      } else {
        break; // literal asterisks, e.g. "2 * 3"
      }
    }
  }
  return stack;
}
