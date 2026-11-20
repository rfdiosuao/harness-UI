import { StreamingMarkdown } from '@harnesskit/react';
import { useEffect, useState } from 'react';

const SAMPLE = `### Why the build kept stale chunks

The \`build\` script passes **\`--emptyOutDir false\`**, so Vite *never* clears \`dist/\` and every hashed bundle from earlier builds stays behind. See the [build options](https://vite.dev/config/build-options) for details.

| Build | JS chunks | Size |
|---|--:|--:|
| Before | 3 | 1.6 MB |
| After | 1 | 417 kB |

**Fix**, in order:

1. Remove the flag from \`package.json\`
2. Delete ~~\`dist/assets\`~~ the whole \`dist/\` once
3. Rebuild

\`\`\`diff
  "scripts": {
-   "build": "vite build --emptyOutDir false",
+   "build": "vite build",
  }
\`\`\`

> After this, every build starts from an empty \`dist/\`.`;

/** Uneven chunk sizes, like a real token stream. */
const CHUNKS = [3, 1, 5, 2, 4, 6, 2, 3, 1, 4];

function useStreamedText(source: string, run: number) {
  const [length, setLength] = useState(0);
  useEffect(() => {
    setLength(0);
    let step = 0;
    const id = window.setInterval(() => {
      setLength((n) => {
        if (n >= source.length) {
          window.clearInterval(id);
          return n;
        }
        return Math.min(source.length, n + CHUNKS[step++ % CHUNKS.length]!);
      });
    }, 45);
    return () => window.clearInterval(id);
  }, [source, run]);
  return { text: source.slice(0, length), streaming: length < source.length };
}

export function MarkdownDemo() {
  const [run, setRun] = useState(0);
  const { text, streaming } = useStreamedText(SAMPLE, run);

  return (
    <section aria-labelledby="md-title" className="mt-14">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 id="md-title" className="mr-auto text-sm font-semibold">
          StreamingMarkdown
        </h2>
        <span className="text-xs text-hk-muted" aria-live="polite">
          {streaming ? 'Streaming…' : 'Finished'}
        </span>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          className="rounded-md border border-hk-border px-2.5 py-1 text-xs font-medium hover:bg-hk-subtle"
        >
          Replay
        </button>
      </div>
      <p className="mb-4 text-sm text-hk-muted">
        The same stream, rendered with and without tail repair. Watch the right side flash raw{' '}
        <code className="font-mono">**</code>, backticks and fence markers.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {[
          { label: 'With repair', repair: true },
          { label: 'Without repair', repair: false },
        ].map(({ label, repair }) => (
          <div key={label} className="min-w-0 rounded-xl border border-hk-border bg-hk-surface/60 p-4">
            <div className="mb-3 font-mono text-[11px] text-hk-muted">{label}</div>
            <StreamingMarkdown text={text} streaming={streaming} repair={repair} className="text-sm" />
          </div>
        ))}
      </div>
    </section>
  );
}
