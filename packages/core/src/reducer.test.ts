import { describe, expect, it } from 'vitest';
import type { HarnessEvent, ToolCallPart, TranscriptState } from './protocol';
import { initialTranscript, reduceTranscript, replay } from './reducer';

const start: HarnessEvent[] = [
  { type: 'message.start', messageId: 'm1', role: 'assistant', at: 0 },
  { type: 'tool.start', messageId: 'm1', partId: 'p1', toolCallId: 't1', name: 'bash', at: 10 },
];

function tool(state: TranscriptState, id = 't1'): ToolCallPart {
  const loc = state.toolIndex[id]!;
  return state.messages[loc.message]!.parts[loc.part] as ToolCallPart;
}

describe('reduceTranscript', () => {
  it('builds text and thinking parts from deltas', () => {
    const state = replay([
      { type: 'message.start', messageId: 'm1', role: 'assistant' },
      { type: 'part.start', messageId: 'm1', partId: 'th', kind: 'thinking', at: 100 },
      { type: 'thinking.delta', messageId: 'm1', partId: 'th', delta: 'Hmm' },
      { type: 'part.end', messageId: 'm1', partId: 'th', at: 1600 },
      { type: 'text.delta', messageId: 'm1', partId: 'tx', delta: 'Hel' },
      { type: 'text.delta', messageId: 'm1', partId: 'tx', delta: 'lo' },
      { type: 'message.end', messageId: 'm1', stopReason: 'end_turn' },
    ]);
    const [thinking, text] = state.messages[0]!.parts;
    expect(thinking).toMatchObject({ kind: 'thinking', text: 'Hmm', streaming: false, startedAt: 100, endedAt: 1600 });
    expect(text).toMatchObject({ kind: 'text', text: 'Hello', streaming: false });
    expect(state.messages[0]).toMatchObject({ streaming: false, stopReason: 'end_turn' });
    expect(state.warnings).toEqual([]);
  });

  it('parses tool input progressively, then completely', () => {
    let state = replay([
      ...start,
      { type: 'tool.input.delta', toolCallId: 't1', delta: '{"command":"ls -' },
    ]);
    expect(tool(state)).toMatchObject({ status: 'input-streaming', input: { command: 'ls -' } });

    state = replay(
      [
        { type: 'tool.input.delta', toolCallId: 't1', delta: 'la"}' },
        { type: 'tool.input.end', toolCallId: 't1' },
      ],
      state,
    );
    expect(tool(state)).toMatchObject({ status: 'pending', input: { command: 'ls -la' } });
  });

  it('treats an empty input as {}', () => {
    const state = replay([...start, { type: 'tool.input.end', toolCallId: 't1' }]);
    expect(tool(state)).toMatchObject({ status: 'pending', input: {} });
  });

  it('runs the full approval lifecycle', () => {
    const state = replay([
      ...start,
      { type: 'tool.input.delta', toolCallId: 't1', delta: '{"command":"rm -rf dist"}' },
      { type: 'tool.input.end', toolCallId: 't1' },
      { type: 'tool.permission.request', toolCallId: 't1', risk: 'high', reason: 'Deletes files' },
      { type: 'tool.permission.resolve', toolCallId: 't1', decision: 'allow', scope: 'always', at: 700 },
      { type: 'tool.output.delta', toolCallId: 't1', delta: 'removed\n' },
      { type: 'tool.result', toolCallId: 't1', output: 'ok', at: 900 },
    ]);
    expect(tool(state)).toMatchObject({
      status: 'success',
      output: 'removed\n',
      result: 'ok',
      startedAt: 10,
      runStartedAt: 700,
      endedAt: 900,
      permission: { risk: 'high', reason: 'Deletes files', decision: 'allow', scope: 'always' },
    });
    expect(state.warnings).toEqual([]);
  });

  it('marks denied calls as terminal', () => {
    const state = replay([
      ...start,
      { type: 'tool.input.end', toolCallId: 't1' },
      { type: 'tool.permission.request', toolCallId: 't1' },
      { type: 'tool.permission.resolve', toolCallId: 't1', decision: 'deny', at: 50 },
      { type: 'tool.run', toolCallId: 't1' },
    ]);
    expect(tool(state)).toMatchObject({ status: 'denied', endedAt: 50 });
    expect(state.warnings).toEqual(['Illegal tool transition denied → running for t1']);
  });

  it('ignores illegal transitions instead of corrupting state', () => {
    const before = replay(start);
    const after = reduceTranscript(before, { type: 'tool.result', toolCallId: 't1', output: 'x' });
    expect(tool(after).status).toBe('input-streaming');
    expect(after.warnings).toHaveLength(1);
  });

  it('flags invalid final input as an error', () => {
    const state = replay([
      ...start,
      { type: 'tool.input.delta', toolCallId: 't1', delta: '{"a":' },
      { type: 'tool.input.end', toolCallId: 't1' },
    ]);
    expect(tool(state).status).toBe('error');
    expect(tool(state).errorMessage).toMatch(/^Invalid tool input/);
  });

  it('errors tools cut off by max_tokens and interrupts other unfinished ones', () => {
    const cut = replay([
      ...start,
      { type: 'tool.input.delta', toolCallId: 't1', delta: '{"a":' },
      { type: 'message.end', messageId: 'm1', stopReason: 'max_tokens' },
    ]);
    expect(tool(cut)).toMatchObject({ status: 'error', errorMessage: 'Tool input was cut off (max_tokens)' });

    const stopped = replay([...start, { type: 'message.end', messageId: 'm1', stopReason: null }]);
    expect(tool(stopped).status).toBe('interrupted');
  });

  it('warns on unknown ids without throwing', () => {
    const state = replay([
      { type: 'text.delta', messageId: 'nope', partId: 'p', delta: 'x' },
      { type: 'tool.run', toolCallId: 'nope' },
    ]);
    expect(state.messages).toEqual([]);
    expect(state.warnings).toHaveLength(2);
  });

  it('never mutates the previous state', () => {
    const before = replay(start);
    const snapshot = JSON.stringify(before);
    reduceTranscript(before, { type: 'tool.input.delta', toolCallId: 't1', delta: '{}' });
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(initialTranscript.messages).toEqual([]);
  });
});
