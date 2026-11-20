import { describe, expect, it } from 'vitest';
import type { AskPart, HarnessEvent, ToolCallPart, TranscriptState } from './protocol';
import { replay } from './reducer';
import { pendingPermissions, pendingRequests, runStatus } from './selectors';

const ask = (overrides: Partial<Extract<HarnessEvent, { type: 'ask.request' }>> = {}): HarnessEvent => ({
  type: 'ask.request',
  messageId: 'm1',
  partId: 'p-ask',
  askId: 'q1',
  question: 'Which CI provider?',
  header: 'CI provider',
  options: [
    { id: 'gha', label: 'GitHub Actions', recommended: true },
    { id: 'gitlab', label: 'GitLab CI' },
  ],
  allowOther: true,
  at: 100,
  ...overrides,
});

const base: HarnessEvent[] = [{ type: 'message.start', messageId: 'm1', role: 'assistant' }];

function askPart(state: TranscriptState, id = 'q1'): AskPart {
  const loc = state.askIndex[id]!;
  return state.messages[loc.message]!.parts[loc.part] as AskPart;
}

function toolPart(state: TranscriptState, id: string): ToolCallPart {
  const loc = state.toolIndex[id]!;
  return state.messages[loc.message]!.parts[loc.part] as ToolCallPart;
}

function tool(id: string, ...after: HarnessEvent[]): HarnessEvent[] {
  return [
    { type: 'tool.start', messageId: 'm1', partId: `p-${id}`, toolCallId: id, name: 'bash' },
    { type: 'tool.input.end', toolCallId: id },
    ...after,
  ];
}

describe('ask events', () => {
  it('records a question and its answer', () => {
    const state = replay([...base, ask(), { type: 'ask.answer', askId: 'q1', answer: { selected: ['gha'] }, at: 900 }]);
    expect(askPart(state)).toMatchObject({
      status: 'answered',
      answer: { selected: ['gha'] },
      multiSelect: false,
      askedAt: 100,
      answeredAt: 900,
    });
    expect(state.warnings).toEqual([]);
  });

  it('accepts a free-text answer when allowed, trimmed', () => {
    const state = replay([...base, ask(), { type: 'ask.answer', askId: 'q1', answer: { selected: [], other: '  Buildkite ' } }]);
    expect(askPart(state).answer).toEqual({ selected: [], other: 'Buildkite' });
  });

  it.each([
    [{ selected: [] }, 'empty answer'],
    [{ selected: ['nope'] }, 'unknown option nope'],
    [{ selected: ['gha', 'gitlab'] }, 'single-select but got 2'],
    [{ selected: ['gha'], other: 'x' }, 'single-select but got 2'],
  ])('rejects invalid answer %j', (answer, message) => {
    const state = replay([...base, ask(), { type: 'ask.answer', askId: 'q1', answer }]);
    expect(askPart(state).status).toBe('pending');
    expect(state.warnings[0]).toContain(message);
  });

  it('rejects free text when not allowed and dedupes multi-select', () => {
    const noOther = replay([...base, ask({ allowOther: false }), { type: 'ask.answer', askId: 'q1', answer: { selected: [], other: 'x' } }]);
    expect(noOther.warnings[0]).toContain('does not accept a free-text answer');

    const multi = replay([...base, ask({ multiSelect: true }), { type: 'ask.answer', askId: 'q1', answer: { selected: ['gha', 'gitlab', 'gha'] } }]);
    expect(askPart(multi).answer).toEqual({ selected: ['gha', 'gitlab'] });
  });

  it('cannot be answered twice or after cancel', () => {
    const state = replay([
      ...base,
      ask(),
      { type: 'ask.cancel', askId: 'q1', reason: 'No longer needed' },
      { type: 'ask.answer', askId: 'q1', answer: { selected: ['gha'] } },
    ]);
    expect(askPart(state)).toMatchObject({ status: 'cancelled', cancelReason: 'No longer needed' });
    expect(state.warnings).toEqual(['Ask q1 is already cancelled']);
  });

  it('rejects questions with no way to answer', () => {
    const state = replay([...base, ask({ options: [], allowOther: false })]);
    expect(state.askIndex).toEqual({});
    expect(state.warnings).toHaveLength(1);
  });
});

describe('turn.interrupt', () => {
  it('stops everything in flight and nothing else', () => {
    const state = replay([
      ...base,
      { type: 'part.start', messageId: 'm1', partId: 'txt', kind: 'text' },
      { type: 'text.delta', messageId: 'm1', partId: 'txt', delta: 'Working' },
      ...tool('done', { type: 'tool.run', toolCallId: 'done' }, { type: 'tool.result', toolCallId: 'done', output: 'ok' }),
      ...tool('busy', { type: 'tool.run', toolCallId: 'busy' }),
      ...tool('gated', { type: 'tool.permission.request', toolCallId: 'gated' }),
      ask(),
      { type: 'turn.interrupt', at: 500 },
    ]);
    const message = state.messages[0]!;
    expect(message).toMatchObject({ streaming: false, stopReason: 'interrupted' });
    expect(message.parts[0]).toMatchObject({ kind: 'text', streaming: false });
    expect(toolPart(state, 'done').status).toBe('success');
    expect(toolPart(state, 'busy')).toMatchObject({ status: 'interrupted', errorMessage: 'Interrupted by user', endedAt: 500 });
    expect(toolPart(state, 'gated').status).toBe('interrupted');
    expect(askPart(state)).toMatchObject({ status: 'cancelled', cancelReason: 'Interrupted by user' });
    expect(runStatus(state)).toBe('idle');
  });

  it('returns the same state when there is nothing to stop', () => {
    const idle = replay([...base, { type: 'message.end', messageId: 'm1' }]);
    expect(replay([{ type: 'turn.interrupt' }], idle)).toBe(idle);
  });
});

describe('queue', () => {
  it('adds and removes queued messages in order', () => {
    const state = replay([
      { type: 'queue.add', queueId: 'a', text: 'also update the README' },
      { type: 'queue.add', queueId: 'b', text: 'and bump the version' },
      { type: 'queue.add', queueId: 'c', text: '   ' },
      { type: 'queue.remove', queueId: 'a' },
      { type: 'queue.remove', queueId: 'zzz' },
    ]);
    expect(state.queue.map((q) => q.id)).toEqual(['b']);
    expect(state.warnings).toEqual(['Queued message c is empty', 'Unknown queueId zzz']);
  });
});

describe('selectors', () => {
  it('lists pending approvals and questions in transcript order', () => {
    const state = replay([
      ...base,
      ...tool('t1', { type: 'tool.permission.request', toolCallId: 't1', risk: 'high' }),
      ask(),
      ...tool('t2', { type: 'tool.permission.request', toolCallId: 't2' }),
      ...tool('t3', { type: 'tool.run', toolCallId: 't3' }),
    ]);
    expect(pendingRequests(state).map((r) => (r.kind === 'ask' ? r.part.askId : r.part.toolCallId))).toEqual(['t1', 'q1', 't2']);
    expect(pendingPermissions(state).map((p) => p.toolCallId)).toEqual(['t1', 't2']);
  });

  it('derives run status', () => {
    expect(runStatus(replay([]))).toBe('idle');
    const streaming = replay(base);
    expect(runStatus(streaming)).toBe('running');
    const running = replay([{ type: 'message.end', messageId: 'm1' }, ...tool('t', { type: 'tool.run', toolCallId: 't' })], streaming);
    expect(runStatus(running)).toBe('running');
    const waiting = replay([ask()], running);
    expect(runStatus(waiting)).toBe('waiting');
  });

  it('remembers the rule for always-allow decisions only', () => {
    const state = replay([
      ...base,
      ...tool('a', { type: 'tool.permission.request', toolCallId: 'a' }),
      ...tool('b', { type: 'tool.permission.request', toolCallId: 'b' }),
      { type: 'tool.permission.resolve', toolCallId: 'a', decision: 'allow', scope: 'always', rule: 'bash(npm *)' },
      { type: 'tool.permission.resolve', toolCallId: 'b', decision: 'allow', scope: 'once', rule: 'ignored' },
    ]);
    expect(toolPart(state, 'a').permission).toMatchObject({ scope: 'always', rule: 'bash(npm *)' });
    expect(toolPart(state, 'b').permission?.rule).toBeUndefined();
  });
});
