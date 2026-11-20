import type Anthropic from '@anthropic-ai/sdk';
import type { HarnessEvent } from '@harnesskit/core';

type Raw = Anthropic.RawMessageStreamEvent;

/**
 * A replay step. `model` steps are Anthropic wire events (fed through the
 * real adapter); `harness` steps are what your tool runner would emit; a
 * `gate` pauses until the user answers the permission prompt.
 */
export type Step =
  | { kind: 'model'; event: Raw; delay: number }
  | { kind: 'harness'; event: HarnessEvent; delay: number }
  | { kind: 'gate'; toolCallId: string };

type Block =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: object };

const raw = (e: object) => e as Raw;

/** Uneven chunks, like real token streams. */
function chunks(text: string, base: number): string[] {
  const sizes = [base, base + 3, base - 2, base + 1, base + 5, base - 1];
  const out: string[] = [];
  for (let i = 0, k = 0; i < text.length; k++) {
    const size = Math.max(1, sizes[k % sizes.length]!);
    out.push(text.slice(i, i + size));
    i += size;
  }
  return out;
}

class Script {
  readonly steps: Step[] = [];

  private model(event: object, delay = 28) {
    this.steps.push({ kind: 'model', event: raw(event), delay });
  }

  harness(event: HarnessEvent, delay = 180) {
    this.steps.push({ kind: 'harness', event, delay });
  }

  gate(toolCallId: string) {
    this.steps.push({ kind: 'gate', toolCallId });
  }

  user(messageId: string, text: string) {
    this.harness({ type: 'message.start', messageId, role: 'user' }, 0);
    this.harness({ type: 'text.delta', messageId, partId: `${messageId}:0`, delta: text }, 0);
    this.harness({ type: 'message.end', messageId }, 500);
  }

  assistant(id: string, blocks: Block[], stopReason: 'tool_use' | 'end_turn') {
    this.model({ type: 'message_start', message: { id, type: 'message', role: 'assistant', content: [] } }, 350);
    blocks.forEach((block, index) => {
      switch (block.type) {
        case 'thinking':
          this.model({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
          for (const c of chunks(block.text, 6)) {
            this.model({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: c } }, 45);
          }
          break;
        case 'text':
          this.model({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
          for (const c of chunks(block.text, 4)) {
            this.model({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: c } });
          }
          break;
        case 'tool_use':
          this.model({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }, 120);
          for (const c of chunks(JSON.stringify(block.input), 5)) {
            this.model({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: c } }, 40);
          }
          break;
      }
      this.model({ type: 'content_block_stop', index }, 200);
    });
    this.model({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 0 } }, 0);
    this.model({ type: 'message_stop' }, 400);
  }

  /** Execute a tool: stream output lines, then report the result. */
  run(toolCallId: string, lines: string[], opts: { approved?: boolean; lineDelay?: number; result?: unknown } = {}) {
    if (!opts.approved) this.harness({ type: 'tool.run', toolCallId }, 150);
    for (const line of lines) {
      this.harness({ type: 'tool.output.delta', toolCallId, delta: `${line}\n` }, opts.lineDelay ?? 90);
    }
    this.harness({ type: 'tool.result', toolCallId, output: opts.result }, 300);
  }
}

const PACKAGE_JSON = `{
  "name": "acme-web",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build --emptyOutDir false",
    "preview": "vite preview"
  }
}`;

export function buildScenario() {
  const main = new Script();
  main.user('u1', 'The build keeps shipping stale chunks. Can you clean out dist/ and rebuild?');
  main.assistant(
    'msg_01',
    [
      {
        type: 'thinking',
        text: 'Stale chunks usually mean old files survive between builds. Check the build script and what is actually in dist/ before deleting anything.',
      },
      { type: 'text', text: "Let me check the build script and what's currently in `dist/`." },
      { type: 'tool_use', id: 'toolu_01', name: 'read_file', input: { file_path: 'package.json' } },
      { type: 'tool_use', id: 'toolu_02', name: 'bash', input: { command: 'ls -lh dist/assets', description: 'List build output' } },
    ],
    'tool_use',
  );
  main.run('toolu_01', PACKAGE_JSON.split('\n'), { lineDelay: 25 });
  main.run('toolu_02', [
    'total 1.6M',
    '-rw-r--r--  1 dev  staff   4.1K Nov 14 09:12 index-4f2a91.css',
    '-rw-r--r--  1 dev  staff   412K Nov 14 09:12 index-4f2a91.js',
    '-rw-r--r--  1 dev  staff   3.9K Oct 28 17:40 index-9c1e07.css',
    '-rw-r--r--  1 dev  staff   409K Oct 28 17:40 index-9c1e07.js',
    '-rw-r--r--  1 dev  staff   388K Sep 30 11:02 index-b03d55.js',
  ]);
  main.assistant(
    'msg_02',
    [
      {
        type: 'text',
        text: 'Found it: the build runs with `--emptyOutDir false`, so three generations of `index-*.js` are piling up. I\'ll delete `dist/` and do a clean build.',
      },
      {
        type: 'tool_use',
        id: 'toolu_03',
        name: 'bash',
        input: { command: 'rm -rf dist && npm run build', description: 'Delete dist/ and rebuild' },
      },
    ],
    'tool_use',
  );
  main.harness({
    type: 'tool.permission.request',
    toolCallId: 'toolu_03',
    risk: 'high',
    reason: 'Recursively deletes dist/ (6 files, 1.6 MB)',
  });
  main.gate('toolu_03');

  const allow = new Script();
  allow.run(
    'toolu_03',
    [
      '> acme-web@0.0.0 build',
      '> vite build --emptyOutDir false',
      '',
      'vite v8.3.8 building for production...',
      '✓ 214 modules transformed.',
      'dist/index.html                  0.46 kB │ gzip:   0.30 kB',
      'dist/assets/index-7d3e2c.css     4.12 kB │ gzip:   1.38 kB',
      'dist/assets/index-7d3e2c.js    412.80 kB │ gzip: 131.02 kB',
      '✓ built in 1.84s',
    ],
    { approved: true, lineDelay: 220 },
  );
  allow.assistant(
    'msg_03',
    [
      {
        type: 'text',
        text: [
          '**Clean build done.** The stale bundles are gone:',
          '',
          '| | JS chunks | Size |',
          '|---|--:|--:|',
          '| Before | 3 | 1.6 MB |',
          '| After | 1 | 417 kB |',
          '',
          'To stop this from coming back, drop the flag from `package.json`:',
          '',
          '```diff',
          '-   "build": "vite build --emptyOutDir false",',
          '+   "build": "vite build",',
          '```',
          '',
          'Want me to make that change?',
        ].join('\n'),
      },
    ],
    'end_turn',
  );

  const deny = new Script();
  deny.assistant(
    'msg_03',
    [
      {
        type: 'text',
        text: "Understood, I left `dist/` alone. The root cause is `--emptyOutDir false` in the build script; removing that flag makes every build start clean without deleting anything by hand.",
      },
    ],
    'end_turn',
  );

  return { main: main.steps, allow: allow.steps, deny: deny.steps };
}
