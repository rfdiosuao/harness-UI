import type Anthropic from '@anthropic-ai/sdk';
import type { HarnessEvent } from '../protocol';

/** Works with both `client.messages.stream()` and `client.beta.messages.stream()`. */
export type AnthropicStreamEvent = Anthropic.RawMessageStreamEvent | Anthropic.Beta.BetaRawMessageStreamEvent;
type RawEvent = AnthropicStreamEvent;

export interface AnthropicAdapterOptions {
  /** Clock used to stamp `at`. Override for deterministic tests. */
  now?: () => number;
}

type BlockInfo =
  | { kind: 'text' | 'thinking'; partId: string }
  | { kind: 'tool'; partId: string; toolCallId: string; server: boolean }
  | { kind: 'ignored' };

/**
 * Translates Anthropic Messages API stream events (`client.messages.stream()`
 * or raw SSE) into harnesskit events.
 *
 * Create one adapter per streamed response; it is stateful because block
 * deltas only carry an index.
 *
 * Client tools stop at `pending` once their input is complete. Your harness
 * then emits `tool.permission.request` / `tool.run` / `tool.output.delta` /
 * `tool.result` as it executes them. Server tools (web search, code
 * execution, …) run on Anthropic's side, so the adapter marks them `running`
 * and resolves them from the matching `*_tool_result` block.
 */
export function createAnthropicAdapter(options: AnthropicAdapterOptions = {}) {
  const now = options.now ?? Date.now;
  let messageId = '';
  let stopReason: string | null = null;
  const blocks = new Map<number, BlockInfo>();

  return function translate(event: RawEvent): HarnessEvent[] {
    const at = now();

    switch (event.type) {
      case 'message_start': {
        messageId = event.message.id;
        stopReason = null;
        blocks.clear();
        return [{ type: 'message.start', messageId, role: 'assistant', at }];
      }

      case 'content_block_start': {
        const partId = `${messageId}:${event.index}`;
        const block = event.content_block;
        switch (block.type) {
          case 'text': {
            blocks.set(event.index, { kind: 'text', partId });
            const out: HarnessEvent[] = [{ type: 'part.start', messageId, partId, kind: 'text', at }];
            if (block.text) out.push({ type: 'text.delta', messageId, partId, delta: block.text, at });
            return out;
          }
          case 'thinking': {
            blocks.set(event.index, { kind: 'thinking', partId });
            const out: HarnessEvent[] = [{ type: 'part.start', messageId, partId, kind: 'thinking', at }];
            if (block.thinking) out.push({ type: 'thinking.delta', messageId, partId, delta: block.thinking, at });
            return out;
          }
          case 'tool_use':
          case 'server_tool_use': {
            const server = block.type === 'server_tool_use';
            blocks.set(event.index, { kind: 'tool', partId, toolCallId: block.id, server });
            return [{ type: 'tool.start', messageId, partId, toolCallId: block.id, name: block.name, at }];
          }
          default: {
            blocks.set(event.index, { kind: 'ignored' });
            // web_search_tool_result, web_fetch_tool_result, code execution
            // results, …: every server tool result block carries tool_use_id.
            const result = block as { type: string; tool_use_id?: unknown; content?: unknown };
            if (result.type.endsWith('_tool_result') && typeof result.tool_use_id === 'string') {
              return [
                {
                  type: 'tool.result',
                  toolCallId: result.tool_use_id,
                  output: result.content,
                  isError: isServerToolError(result.content),
                  at,
                },
              ];
            }
            return [];
          }
        }
      }

      case 'content_block_delta': {
        const info = blocks.get(event.index);
        if (!info || info.kind === 'ignored') return [];
        const delta = event.delta;
        switch (delta.type) {
          case 'text_delta':
            return info.kind === 'text'
              ? [{ type: 'text.delta', messageId, partId: info.partId, delta: delta.text, at }]
              : [];
          case 'thinking_delta':
            return info.kind === 'thinking'
              ? [{ type: 'thinking.delta', messageId, partId: info.partId, delta: delta.thinking, at }]
              : [];
          case 'input_json_delta':
            return info.kind === 'tool'
              ? [{ type: 'tool.input.delta', toolCallId: info.toolCallId, delta: delta.partial_json, at }]
              : [];
          default:
            // signature_delta, citations_delta: not rendered (yet).
            return [];
        }
      }

      case 'content_block_stop': {
        const info = blocks.get(event.index);
        if (!info || info.kind === 'ignored') return [];
        if (info.kind === 'tool') {
          const out: HarnessEvent[] = [{ type: 'tool.input.end', toolCallId: info.toolCallId, at }];
          if (info.server) out.push({ type: 'tool.run', toolCallId: info.toolCallId, at });
          return out;
        }
        return [{ type: 'part.end', messageId, partId: info.partId, at }];
      }

      case 'message_delta':
        stopReason = event.delta.stop_reason ?? stopReason;
        return [];

      case 'message_stop':
        return [{ type: 'message.end', messageId, stopReason, at }];

      default:
        return [];
    }
  };
}

/** Server tool errors arrive as HTTP 200 with an error object as `content`. */
function isServerToolError(content: unknown): boolean {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return false;
  const c = content as { type?: unknown; error_code?: unknown };
  return (typeof c.type === 'string' && c.type.endsWith('_error')) || c.error_code !== undefined;
}
