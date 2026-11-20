import { repairMarkdown } from '@harnesskit/core';
import { Check, Copy } from 'lucide-react';
import { Lexer, type Token, type Tokens } from 'marked';
import {
  createContext,
  Fragment,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { cx } from './utils';

export interface CodeBlockProps {
  code: string;
  language?: string;
  /** True while this block is still receiving text. */
  streaming: boolean;
  /** Streaming caret to render after the code, when this is the last block. */
  caret?: ReactNode;
}

export type UrlKind = 'link' | 'image';

export interface StreamingMarkdownProps {
  /** The Markdown received so far. */
  text: string;
  /** While true, the incomplete tail is repaired and a caret is shown. */
  streaming?: boolean;
  /** Close half-written syntax while streaming. On by default; off is mainly for comparison. */
  repair?: boolean;
  /** Decide which URLs may become links and images. Defaults to http(s), mailto and relative URLs. */
  isSafeUrl?: (url: string, kind: UrlKind) => boolean;
  /** Replace the code block, e.g. to add syntax highlighting. */
  CodeBlock?: ComponentType<CodeBlockProps>;
  className?: string;
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

/**
 * Raw HTML in the source is always shown as text, never rendered, so the only
 * injection surface is URLs. Allow-list schemes rather than block-list them.
 */
export function defaultIsSafeUrl(url: string, kind: UrlKind): boolean {
  const trimmed = url.trim();
  // Relative URLs and fragments have no scheme.
  if (/^(?:[/#?.]|[^:/?#]+(?:[/?#]|$))/.test(trimmed)) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (kind === 'image') return scheme === 'https' || scheme === 'http';
  return scheme === 'https' || scheme === 'http' || scheme === 'mailto';
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
};

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface RenderContext {
  isSafeUrl: (url: string, kind: UrlKind) => boolean;
  CodeBlock: ComponentType<CodeBlockProps>;
  streaming: boolean;
}

const Ctx = createContext<RenderContext | null>(null);

function useRender(): RenderContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('StreamingMarkdown internals rendered outside StreamingMarkdown');
  return ctx;
}

export function StreamingCaret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[1em] w-[0.45ch] translate-y-[0.15em] bg-hk-accent [animation:hk-caret_1s_steps(1)_infinite] motion-reduce:animate-none"
    />
  );
}

function renderInline(tokens: Token[] | undefined, ctx: RenderContext): ReactNode {
  if (!tokens) return null;
  return tokens.map((token, i) => <Fragment key={i}>{renderInlineToken(token, ctx)}</Fragment>);
}

function renderInlineToken(token: Token, ctx: RenderContext): ReactNode {
  switch (token.type) {
    case 'text':
      return 'tokens' in token && token.tokens ? renderInline(token.tokens, ctx) : decodeEntities(token.text);
    case 'escape':
      return token.text;
    case 'strong':
      return <strong className="font-semibold">{renderInline(token.tokens, ctx)}</strong>;
    case 'em':
      return <em>{renderInline(token.tokens, ctx)}</em>;
    case 'del':
      return <del className="text-hk-muted">{renderInline(token.tokens, ctx)}</del>;
    case 'codespan':
      return (
        <code className="rounded bg-hk-subtle px-1 py-px font-mono text-[0.875em] [overflow-wrap:anywhere]">
          {token.text}
        </code>
      );
    case 'br':
      return <br />;
    case 'link': {
      const t = token as Tokens.Link;
      const content = renderInline(t.tokens, ctx);
      if (!ctx.isSafeUrl(t.href, 'link')) return <span>{content}</span>;
      const external = /^[a-z][a-z0-9+.-]*:/i.test(t.href.trim());
      return (
        <a
          href={t.href}
          title={t.title ?? undefined}
          className="text-hk-accent underline decoration-hk-accent/40 underline-offset-2 hover:decoration-hk-accent"
          {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
        >
          {content}
        </a>
      );
    }
    case 'image': {
      const t = token as Tokens.Image;
      if (!ctx.isSafeUrl(t.href, 'image')) return t.text;
      return (
        <img
          src={t.href}
          alt={t.text}
          title={t.title ?? undefined}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="my-2 inline-block max-w-full rounded-md"
        />
      );
    }
    case 'html':
      // Shown, not rendered.
      return token.raw;
    default:
      return 'raw' in token ? token.raw : null;
  }
}

/** Renders a run of block tokens, passing the caret to the last one. */
function renderBlocks(tokens: Token[], caret: ReactNode, ctx: RenderContext): ReactNode {
  let last = tokens.length - 1;
  while (last >= 0 && tokens[last]!.type === 'space') last--;
  return tokens.map((token, i) => (
    <Fragment key={i}>{renderBlock(token, i === last ? caret : null, ctx)}</Fragment>
  ));
}

const HEADING_STYLES = [
  'mt-6 mb-3 text-xl font-semibold tracking-tight',
  'mt-6 mb-2.5 text-lg font-semibold tracking-tight',
  'mt-5 mb-2 text-base font-semibold',
  'mt-4 mb-2 text-sm font-semibold',
  'mt-4 mb-2 text-sm font-semibold text-hk-muted',
  'mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-hk-muted',
];

function renderBlock(token: Token, caret: ReactNode, ctx: RenderContext): ReactNode {
  switch (token.type) {
    case 'space':
    case 'def':
      return null;

    case 'paragraph':
      return (
        <p className="my-3 leading-relaxed first:mt-0 last:mb-0">
          {renderInline(token.tokens, ctx)}
          {caret}
        </p>
      );

    case 'text':
      // Tight list items carry bare text blocks.
      return (
        <>
          {'tokens' in token && token.tokens ? renderInline(token.tokens, ctx) : decodeEntities(token.text)}
          {caret}
        </>
      );

    case 'heading': {
      const t = token as Tokens.Heading;
      const Tag = `h${Math.min(Math.max(t.depth, 1), 6)}` as 'h1';
      return (
        <Tag className={cx(HEADING_STYLES[t.depth - 1], 'first:mt-0')}>
          {renderInline(t.tokens, ctx)}
          {caret}
        </Tag>
      );
    }

    case 'code': {
      const t = token as Tokens.Code;
      const { CodeBlock } = ctx;
      return (
        <CodeBlock
          code={t.text}
          language={t.lang?.trim().split(/\s+/)[0] || undefined}
          streaming={ctx.streaming && caret !== null}
          caret={caret}
        />
      );
    }

    case 'blockquote':
      return (
        <blockquote className="my-3 border-l-2 border-hk-border pl-3 text-hk-muted first:mt-0 last:mb-0">
          {renderBlocks(token.tokens ?? [], caret, ctx)}
        </blockquote>
      );

    case 'list': {
      const t = token as Tokens.List;
      const items = t.items.map((item, i) => {
        const itemCaret = i === t.items.length - 1 ? caret : null;
        const body = item.tokens.filter((x) => x.type !== 'checkbox');
        return (
          <li key={i} className={cx('pl-1 [&>p]:my-1', item.task && 'list-none -ml-5')}>
            {item.task && (
              <input
                type="checkbox"
                checked={!!item.checked}
                disabled
                readOnly
                className="mr-2 size-3.5 translate-y-[0.1em] accent-hk-accent"
              />
            )}
            {renderBlocks(body, itemCaret, ctx)}
          </li>
        );
      });
      const cls = 'my-3 space-y-1 pl-5 first:mt-0 last:mb-0 marker:text-hk-muted';
      if (t.ordered) {
        const start = typeof t.start === 'number' ? t.start : undefined;
        return (
          <ol start={start} className={cx(cls, 'list-decimal')}>
            {items}
          </ol>
        );
      }
      return <ul className={cx(cls, 'list-disc')}>{items}</ul>;
    }

    case 'table': {
      const t = token as Tokens.Table;
      const align = (a: Tokens.TableCell['align']) =>
        a === 'center' ? 'text-center' : a === 'right' ? 'text-right' : 'text-left';
      const lastRow = t.rows.length - 1;
      return (
        <div className="my-3 overflow-x-auto rounded-md border border-hk-border first:mt-0 last:mb-0">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-hk-subtle">
              <tr>
                {t.header.map((cell, i) => (
                  <th key={i} className={cx('px-3 py-1.5 font-semibold', align(cell.align))}>
                    {renderInline(cell.tokens, ctx)}
                    {lastRow < 0 && i === t.header.length - 1 && caret}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, r) => (
                <tr key={r} className="border-t border-hk-border">
                  {row.map((cell, c) => (
                    <td key={c} className={cx('px-3 py-1.5 align-top', align(cell.align))}>
                      {renderInline(cell.tokens, ctx)}
                      {r === lastRow && c === row.length - 1 && caret}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'hr':
      return <hr className="my-5 border-hk-border" />;

    case 'html':
      // Shown, not rendered.
      return (
        <p className="my-3 whitespace-pre-wrap leading-relaxed">
          {token.raw}
          {caret}
        </p>
      );

    default:
      return 'raw' in token ? (
        <p className="my-3 whitespace-pre-wrap">
          {token.raw}
          {caret}
        </p>
      ) : null;
  }
}

/**
 * A top-level block. Finished blocks keep the same `raw` text from frame to
 * frame, so only the block that is still streaming re-renders.
 */
const Block = memo(
  function Block({ token, last }: { token: Token; last: boolean }) {
    const ctx = useRender();
    return <>{renderBlock(token, last && ctx.streaming ? <StreamingCaret /> : null, ctx)}</>;
  },
  (a, b) => a.token.raw === b.token.raw && a.last === b.last,
);

// ---------------------------------------------------------------------------
// Default code block
// ---------------------------------------------------------------------------

export function DefaultCodeBlock({ code, language, streaming, caret }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context, denied permission).
    }
  };

  return (
    <div className="group/code my-3 overflow-hidden rounded-md border border-hk-border bg-hk-subtle first:mt-0 last:mb-0">
      <div className="flex items-center justify-between border-b border-hk-border px-3 py-1">
        <span className="font-mono text-[11px] text-hk-muted">{language ?? 'text'}</span>
        <button
          type="button"
          onClick={copy}
          disabled={streaming}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-hk-muted hover:bg-hk-surface hover:text-hk-fg disabled:opacity-0 focus-visible:outline-2 focus-visible:outline-hk-accent"
        >
          {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-xs leading-relaxed">
        <code>
          {code}
          {caret}
        </code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders Markdown that is still arriving.
 *
 * - The unfinished tail is repaired (see `repairMarkdown`), so half-written
 *   `**bold`, `` `code ``, links and code fences render as they will end up.
 * - Finished blocks are memoized; each new chunk re-renders only the last one.
 * - Raw HTML is shown as text, never rendered; URLs pass through `isSafeUrl`.
 */
export function StreamingMarkdown({
  text,
  streaming = false,
  repair = true,
  isSafeUrl = defaultIsSafeUrl,
  CodeBlock = DefaultCodeBlock,
  className,
}: StreamingMarkdownProps) {
  const tokens = useMemo(() => {
    const source = streaming && repair ? repairMarkdown(text) : text;
    return Lexer.lex(source, { gfm: true });
  }, [text, streaming, repair]);

  const ctx = useMemo<RenderContext>(() => ({ isSafeUrl, CodeBlock, streaming }), [isSafeUrl, CodeBlock, streaming]);

  let last = tokens.length - 1;
  while (last >= 0 && tokens[last]!.type === 'space') last--;

  return (
    <Ctx.Provider value={ctx}>
      <div className={cx('text-hk-fg [overflow-wrap:break-word]', className)} data-streaming={streaming || undefined}>
        {tokens.map((token, i) => (
          <Block key={i} token={token} last={i === last} />
        ))}
        {streaming && last < 0 && <StreamingCaret />}
      </div>
    </Ctx.Provider>
  );
}
