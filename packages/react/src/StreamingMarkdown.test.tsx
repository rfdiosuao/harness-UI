import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultIsSafeUrl, StreamingMarkdown } from './StreamingMarkdown';

const html = (text: string, streaming = false, repair = true) =>
  renderToStaticMarkup(<StreamingMarkdown text={text} streaming={streaming} repair={repair} />);

/** Visible text, roughly: tags stripped, the few entities React emits decoded. */
const visible = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');

const DOC = `## Clean build

The build ran with **\`--emptyOutDir false\`**, so *three* generations piled up. See [the Vite docs](https://vite.dev/config/build-options).

| Chunk | Before | After |
|---|--:|--:|
| JS | 3 | 1 |
| **Total** | 1.6 MB | 417 kB |

- [x] Delete \`dist/\`
- [ ] Remove the flag
  1. Open \`package.json\`
  2. Edit ~~the~~ \`build\`

> Builds now start clean.

\`\`\`diff
- "build": "vite build --emptyOutDir false",
+ "build": "vite build",
\`\`\`

Done.`;

describe('StreamingMarkdown', () => {
  it('renders GFM: headings, emphasis, links, tables, task lists, quotes, code', () => {
    const out = html(DOC);
    expect(out).toContain('<h2');
    expect(out).toContain('<strong class="font-semibold"><code');
    expect(out).toContain('<em>three</em>');
    expect(out).toContain('href="https://vite.dev/config/build-options"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toMatch(/<table[\s\S]*<th class="[^"]*text-right/);
    expect(out).toMatch(/<input type="checkbox" disabled=""[^>]*checked=""\/>Delete/);
    expect(out).toContain('<ol');
    expect(out).toContain('<del');
    expect(out).toContain('<blockquote');
    expect(out).toMatch(/>diff<\/span>/);
    expect(out).not.toContain('aria-hidden="true" class="ml-0.5'); // no caret when not streaming
  });

  it('never shows raw markers at any point while streaming', () => {
    for (let i = 1; i <= DOC.length; i++) {
      const prefix = DOC.slice(0, i);
      const text = visible(html(prefix, true));
      // The document's only literal markers live inside code blocks/spans.
      const outsideCode = text.replace(/"build": "vite build[^"]*",/g, '');
      expect(outsideCode, `prefix ${i}: ${JSON.stringify(prefix.slice(-20))}`).not.toMatch(/\*\*|~~|\]\(/);
      expect(outsideCode, `prefix ${i}`).not.toMatch(/(^|[^`])`(?!`)/);
    }
  });

  it('shows a caret only while streaming', () => {
    expect(html('Hello', true)).toContain('hk-caret');
    expect(html('Hello', false)).not.toContain('hk-caret');
    expect(html('', true)).toContain('hk-caret');
  });

  it('puts the caret inside an open code block', () => {
    const out = html('```ts\nconst a', true);
    expect(out).toMatch(/<code>const a<span[^>]*hk-caret/);
  });

  it('can turn repair off for comparison', () => {
    expect(visible(html('A **bo', true, false))).toContain('**bo');
    expect(visible(html('A **bo', true, true))).not.toContain('**');
  });

  it('decodes common HTML entities in text', () => {
    expect(visible(html('Tom &amp; Jerry &copy; 2026 &#x1F600;'))).toContain('Tom & Jerry © 2026 😀');
  });

  describe('safety', () => {
    const attacks = [
      '[x](javascript:alert(1))',
      '[x](JaVaScRiPt:alert(1))',
      '[x]( javascript:alert(1))',
      '[x](java\tscript:alert(1))',
      '[x](data:text/html,<script>alert(1)</script>)',
      '[x](vbscript:msgbox(1))',
      '[x](&#106;avascript:alert(1))',
      '<javascript:alert(1)>',
      '![x](javascript:alert(1))',
      '![x](data:image/svg+xml,<svg onload=alert(1)>)',
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      'Inline <b onclick="alert(1)">bold</b> html',
      '<iframe src="https://evil.example"></iframe>',
    ];

    it.each(attacks)('neutralizes %s', (attack) => {
      for (const streaming of [false, true]) {
        const out = html(attack, streaming);
        expect(out).not.toMatch(/<(script|iframe|img[^>]*onerror|b[^>]*onclick)/i);
        expect(out).not.toMatch(/(href|src)="\s*(javascript|vbscript|data|&#)/i);
      }
    });

    it('allows only safe URL schemes by default', () => {
      expect(defaultIsSafeUrl('https://a.dev', 'link')).toBe(true);
      expect(defaultIsSafeUrl('mailto:a@b.dev', 'link')).toBe(true);
      expect(defaultIsSafeUrl('/docs', 'link')).toBe(true);
      expect(defaultIsSafeUrl('#anchor', 'link')).toBe(true);
      expect(defaultIsSafeUrl('docs/page.md', 'link')).toBe(true);
      expect(defaultIsSafeUrl('javascript:alert(1)', 'link')).toBe(false);
      expect(defaultIsSafeUrl('mailto:a@b.dev', 'image')).toBe(false);
      expect(defaultIsSafeUrl('data:image/png;base64,AAA', 'image')).toBe(false);
    });
  });
});
