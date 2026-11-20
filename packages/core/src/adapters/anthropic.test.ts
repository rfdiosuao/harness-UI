import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { ToolCallPart } from '../protocol';
import { replay } from '../reducer';
import { createAnthropicAdapter } from './anthropic';

type RawEvent = Anthropic.RawMessageStreamEvent;

// Wire-format events as the API sends them (trimmed to the fields we read).
const raw = (e: object) => e as RawEvent;

const stream: RawEvent[] = [
  raw({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [] } }),
  raw({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
  raw({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Check dist first.' } }),
  raw({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }),
  raw({ type: 'content_block_stop', index: 0 }),
  raw({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
  raw({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Let me ' } }),
  raw({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'look.' } }),
  raw({ type: 'content_block_stop', index: 1 }),
  raw({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash', input: {} } }),
  raw({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"comma' } }),
  raw({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'nd":"ls dist"}' } }),
  raw({ type: 'content_block_stop', index: 2 }),
  raw({ type: 'content_block_start', index: 3, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} } }),
  raw({ type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"query":"vite chunks"}' } }),
  raw({ type: 'content_block_stop', index: 3 }),
  raw({
    type: 'content_block_start',
    index: 4,
    content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://example.com' }] },
  }),
  raw({ type: 'content_block_stop', index: 4 }),
  raw({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 42 } }),
  raw({ type: 'message_stop' }),
];

describe('createAnthropicAdapter', () => {
  it('translates a streamed response into a transcript', () => {
    let clock = 0;
    const translate = createAnthropicAdapter({ now: () => (clock += 10) });
    const state = replay(stream.flatMap(translate));

    expect(state.warnings).toEqual([]);
    const message = state.messages[0]!;
    expect(message).toMatchObject({ id: 'msg_1', role: 'assistant', streaming: false, stopReason: 'tool_use' });

    const [thinking, text, bash, search] = message.parts;
    expect(thinking).toMatchObject({ kind: 'thinking', text: 'Check dist first.', streaming: false });
    expect(text).toMatchObject({ kind: 'text', text: 'Let me look.', streaming: false });

    // Client tool: input complete, waiting for the harness to act.
    expect(bash).toMatchObject({ kind: 'tool', toolCallId: 'toolu_1', name: 'bash', status: 'pending', input: { command: 'ls dist' } });

    // Server tool: Anthropic ran it and returned the result in-stream.
    expect(search).toMatchObject({ kind: 'tool', name: 'web_search', status: 'success', input: { query: 'vite chunks' } });
    expect((search as ToolCallPart).result).toEqual([{ type: 'web_search_result', url: 'https://example.com' }]);
  });

  it('marks server tool error objects as errors', () => {
    const translate = createAnthropicAdapter();
    const events = [
      stream[0]!,
      raw({ type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} } }),
      raw({ type: 'content_block_stop', index: 0 }),
      raw({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'web_search_tool_result', tool_use_id: 's1', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
      }),
    ].flatMap(translate);
    const state = replay(events);
    expect((state.messages[0]!.parts[0] as ToolCallPart).status).toBe('error');
  });

  it('streams partial tool input before the block closes', () => {
    const translate = createAnthropicAdapter();
    const state = replay(stream.slice(0, 11).flatMap(translate));
    const bash = state.messages[0]!.parts[2] as ToolCallPart;
    expect(bash.status).toBe('input-streaming');
    expect(bash.input).toEqual({});
  });
});
