import type Anthropic from '@anthropic-ai/sdk';
import type { AskPart, HarnessEvent, RiskLevel, ToolCallPart, TranscriptState } from '@harnesskit/core';

type Raw = Anthropic.RawMessageStreamEvent;

/**
 * A replay step.
 * - `model`: an Anthropic wire event, fed through the real adapter.
 * - `harness`: what your tool runner would emit.
 * - `wait`: pause until the transcript satisfies a condition (the user answered, approved…).
 * - `then`: build the next steps from the transcript, so the story follows the user's choices.
 */
export type Step =
  | { kind: 'model'; event: Raw; delay: number }
  | { kind: 'harness'; event: HarnessEvent; delay: number }
  | { kind: 'wait'; until: (state: TranscriptState) => boolean }
  | { kind: 'then'; next: (state: TranscriptState) => Step[] };

type Block =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: object };

const raw = (e: object) => e as Raw;

export const MODEL = 'claude-opus-5-5';

interface UsageSim {
  input: number;
  cacheRead: number;
}

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

export class Script {
  readonly steps: Step[] = [];

  private model(event: object, delay = 28) {
    this.steps.push({ kind: 'model', event: raw(event), delay });
  }

  harness(event: HarnessEvent, delay = 180) {
    this.steps.push({ kind: 'harness', event, delay });
  }

  wait(until: (state: TranscriptState) => boolean) {
    this.steps.push({ kind: 'wait', until });
  }

  then(next: (state: TranscriptState) => Step[]) {
    this.steps.push({ kind: 'then', next });
  }

  user(messageId: string, text: string) {
    this.harness({ type: 'message.start', messageId, role: 'user' }, 0);
    this.harness({ type: 'text.delta', messageId, partId: `${messageId}:0`, delta: text }, 0);
    this.harness({ type: 'message.end', messageId }, 500);
  }

  assistant(id: string, blocks: Block[], stopReason: 'tool_use' | 'end_turn', usage: UsageSim = { input: 1500, cacheRead: 20_000 }) {
    this.model(
      {
        type: 'message_start',
        message: {
          id,
          type: 'message',
          role: 'assistant',
          model: MODEL,
          content: [],
          usage: { input_tokens: usage.input, cache_read_input_tokens: usage.cacheRead, cache_creation_input_tokens: 0, output_tokens: 1 },
        },
      },
      350,
    );
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
          for (const c of chunks(JSON.stringify(block.input), 7)) {
            this.model({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: c } }, 25);
          }
          break;
      }
      this.model({ type: 'content_block_stop', index }, 200);
    });
    // Roughly 3.5 characters per token, plus thinking overhead.
    const written = blocks.reduce((n, b) => n + (b.type === 'tool_use' ? JSON.stringify(b.input).length : b.text.length), 0);
    const output = Math.round(written / 3.5) + 40;
    this.model({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: output } }, 0);
    this.model({ type: 'message_stop' }, 400);
  }

  /** Execute a tool: stream output lines, then report the result. */
  run(toolCallId: string, lines: string[], opts: { approved?: boolean; lineDelay?: number } = {}) {
    if (!opts.approved) this.harness({ type: 'tool.run', toolCallId }, 150);
    for (const line of lines) {
      this.harness({ type: 'tool.output.delta', toolCallId, delta: `${line}\n` }, opts.lineDelay ?? 90);
    }
    this.harness({ type: 'tool.result', toolCallId }, 300);
  }
}

// ---------------------------------------------------------------------------
// The "set up CI" story
// ---------------------------------------------------------------------------

const PROVIDERS = [
  { id: 'gha', label: 'GitHub Actions', description: 'The repo is on GitHub, and it is free for public repos.', recommended: true },
  { id: 'gitlab', label: 'GitLab CI', description: 'If you mirror to GitLab.' },
  { id: 'circle', label: 'CircleCI', description: 'Faster caches, separate account.' },
];

const CHECKS = [
  { id: 'typecheck', label: 'Typecheck', description: 'tsc --noEmit', recommended: true, command: 'npm run typecheck' },
  { id: 'test', label: 'Unit tests', description: 'vitest run', recommended: true, command: 'npm test' },
  { id: 'build', label: 'Production build', description: 'vite build', command: 'npm run build' },
  { id: 'lint', label: 'Lint', description: 'eslint .', command: 'npm run lint' },
];

function askAt(state: TranscriptState, askId: string): AskPart | undefined {
  const loc = state.askIndex[askId];
  return loc ? (state.messages[loc.message]!.parts[loc.part] as AskPart) : undefined;
}

function toolAt(state: TranscriptState, id: string): ToolCallPart | undefined {
  const loc = state.toolIndex[id];
  return loc ? (state.messages[loc.message]!.parts[loc.part] as ToolCallPart) : undefined;
}

export function buildScenario(): Step[] {
  const s = new Script();
  s.user('u1', 'Set up CI for this repo.');
  s.assistant(
    'msg_01',
    [
      {
        type: 'thinking',
        text: 'Before writing a workflow I need two things only the user knows: which CI provider, and which checks they want gating pull requests. Ask both at once.',
      },
      { type: 'text', text: 'Two quick questions before I write the workflow:' },
    ],
    'tool_use',
    { input: 3200, cacheRead: 15_800 },
  );
  s.harness({
    type: 'ask.request',
    messageId: 'msg_01',
    partId: 'msg_01:ask-provider',
    askId: 'provider',
    header: 'CI provider',
    question: 'Which CI provider should I set up?',
    options: PROVIDERS,
    allowOther: true,
  }, 120);
  s.harness({
    type: 'ask.request',
    messageId: 'msg_01',
    partId: 'msg_01:ask-checks',
    askId: 'checks',
    header: 'Checks',
    question: 'What should run on every pull request?',
    options: CHECKS.map(({ command: _, ...o }) => o),
    multiSelect: true,
  }, 0);
  s.wait((st) => askAt(st, 'provider')?.status === 'answered' && askAt(st, 'checks')?.status === 'answered');
  s.then(proposeChanges);
  return s.steps;
}

interface Change {
  id: string;
  name: string;
  input: object;
  risk: RiskLevel;
  reason: string;
  done: string;
  output: string[];
}

function proposeChanges(state: TranscriptState): Step[] {
  const provider = askAt(state, 'provider')!.answer!;
  const checks = CHECKS.filter((c) => askAt(state, 'checks')!.answer!.selected.includes(c.id));
  const providerId = provider.selected[0];
  const providerName = provider.other ?? PROVIDERS.find((p) => p.id === providerId)!.label;
  const commands = checks.map((c) => c.command);

  const run = commands.map((c) => `      - run: ${c}`).join('\n');
  const config =
    providerId === 'gha'
      ? {
          path: '.github/workflows/ci.yml',
          content: `name: CI\non:\n  pull_request:\n  push:\n    branches: [main]\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: npm\n      - run: npm ci\n${run}\n`,
        }
      : providerId === 'gitlab'
        ? { path: '.gitlab-ci.yml', content: `image: node:22\nci:\n  script:\n    - npm ci\n${commands.map((c) => `    - ${c}`).join('\n')}\n` }
        : providerId === 'circle'
          ? {
              path: '.circleci/config.yml',
              content: `version: 2.1\njobs:\n  ci:\n    docker:\n      - image: cimg/node:22.0\n    steps:\n      - checkout\n      - run: npm ci\n${commands.map((c) => `      - run: ${c}`).join('\n')}\nworkflows:\n  ci:\n    jobs: [ci]\n`,
            }
          : { path: 'scripts/ci.sh', content: `#!/usr/bin/env sh\nset -e\nnpm ci\n${commands.join('\n')}\n` };

  const changes: Change[] = [
    {
      id: 'toolu_write',
      name: 'write_file',
      input: { file_path: config.path, content: config.content },
      risk: 'medium',
      reason: `Creates ${config.path}`,
      done: `Created \`${config.path}\` running ${checks.map((c) => c.label.toLowerCase()).join(', ')}`,
      output: [`Wrote ${config.content.split('\n').length - 1} lines to ${config.path}`],
    },
  ];
  if (checks.some((c) => c.id === 'typecheck')) {
    changes.push({
      id: 'toolu_script',
      name: 'bash',
      input: { command: 'npm pkg set scripts.typecheck="tsc --noEmit"' },
      risk: 'low',
      reason: 'Adds a typecheck script to package.json',
      done: 'Added `npm run typecheck` to package.json',
      output: [],
    });
  }
  if (providerId === 'gha') {
    changes.push({
      id: 'toolu_protect',
      name: 'bash',
      input: { command: 'gh api -X PUT repos/acme/web/branches/main/protection --input protection.json' },
      risk: 'high',
      reason: 'Changes branch protection on main: merges will require CI to pass.',
      done: 'Protected `main`: pull requests need a green CI run to merge',
      output: ['{', '  "required_status_checks": { "strict": true, "contexts": ["ci"] },', '  "enforce_admins": false', '}'],
    });
  }

  const s = new Script();
  const list = checks.map((c) => `\`${c.command}\``).join(', ');
  s.assistant(
    'msg_02',
    [
      {
        type: 'text',
        text: `Setting up **${providerName}** to run ${list || 'no checks yet'} on every pull request. ${
          changes.length === 1 ? 'One change, which needs' : `${changes.length} changes, each needs`
        } your OK:`,
      },
      ...changes.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input })),
    ],
    'tool_use',
    { input: 2900, cacheRead: 19_600 },
  );
  for (const c of changes) {
    s.harness({ type: 'tool.permission.request', toolCallId: c.id, risk: c.risk, reason: c.reason }, 60);
  }
  s.wait((st) => changes.every((c) => toolAt(st, c.id)?.status !== 'awaiting-permission'));
  s.then((st) => finish(st, changes));
  return s.steps;
}

function finish(state: TranscriptState, changes: Change[]): Step[] {
  const s = new Script();
  const allowed = changes.filter((c) => toolAt(state, c.id)?.permission?.decision === 'allow');
  const denied = changes.filter((c) => toolAt(state, c.id)?.permission?.decision === 'deny');
  for (const c of allowed) s.run(c.id, c.output, { approved: true, lineDelay: 160 });

  const lines: string[] = [];
  if (allowed.length === 0) {
    lines.push('**Nothing changed.** You denied every step, so the repo is as it was.');
  } else {
    lines.push(allowed.length === changes.length ? '**CI is set up.**' : '**CI is partly set up.**', '');
    for (const c of allowed) lines.push(`- ${c.done}`);
    for (const c of denied) lines.push(`- Skipped (you denied it): ${c.reason.charAt(0).toLowerCase()}${c.reason.slice(1)}`);
    lines.push('', 'Push a branch and open a pull request to see it run.');
  }
  s.assistant('msg_03', [{ type: 'text', text: lines.join('\n') }], 'end_turn', { input: 4100, cacheRead: 23_100 });
  return s.steps;
}

/** Reply to a message the user queued or sent after the run. */
export function followUp(n: number, text: string): Step[] {
  const s = new Script();
  s.user(`u-f${n}`, text);
  s.assistant(
    `msg-f${n}`,
    [
      {
        type: 'text',
        text: `Got it: *${text.replace(/[*_`[\]]/g, '')}*. This playground is scripted, so I can't act on it, but in a real harness a queued message starts the next turn as soon as the agent is free.`,
      },
    ],
    'end_turn',
    { input: 1200 + 300 * n, cacheRead: 26_500 + 1800 * n },
  );
  return s.steps;
}
