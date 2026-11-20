import type Anthropic from '@anthropic-ai/sdk';
import type { HarnessEvent, TokenUsage } from '../protocol';

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
  let model: string | undefined;
  let stopReason: string | null = null;
  const blocks = new Map<number, BlockInfo>();

  return function translate(event: RawEvent): HarnessEvent[] {
    const at = now();

    switch (event.type) {
      case 'message_start': {
        messageId = event.message.id;
        model = event.message.model;
        stopReason = null;
        blocks.clear();
        const out: HarnessEvent[] = [{ type: 'message.start', messageId, role: 'assistant', model, at }];
        const usage = readUsage(event.message.usage);
        if (usage) out.push({ type: 'usage', messageId, model, usage, at });
        return out;
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
            // Server-side fallback: `{type: 'fallback', from: {model}, to: {model}}`
            // marks where another model took over. Streamed content stays valid.
            const fallback = block as { type: string; from?: { model?: unknown }; to?: { model?: unknown } };
            if (fallback.type === 'fallback' && typeof fallback.to?.model === 'string') {
              const from = typeof fallback.from?.model === 'string' ? fallback.from.model : (model ?? 'unknown');
              model = fallback.to.model;
              return [{ type: 'model.fallback', messageId, partId, from, to: model, at }];
            }
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

      case 'message_delta': {
        stopReason = event.delta.stop_reason ?? stopReason;
        const out: HarnessEvent[] = [];
        const usage = readUsage(event.usage);
        if (usage) out.push({ type: 'usage', messageId, model, usage, at });
        if (event.delta.stop_reason === 'refusal') {
          // HTTP 200 with a refusal: not thrown, so surface it as an error here.
          const details = (event.delta as { stop_details?: { category?: unknown; explanation?: unknown } | null })
            .stop_details;
          out.push({
            type: 'error',
            errorId: `${messageId}:refusal`,
            kind: 'refusal',
            message:
              typeof details?.explanation === 'string' && details.explanation
                ? details.explanation
                : 'The model declined to continue with this request.',
            category: typeof details?.category === 'string' ? details.category : undefined,
            retryable: false,
            messageId,
            at,
          });
        }
        return out;
      }

      case 'message_stop':
        return [{ type: 'message.end', messageId, stopReason, at }];

      default:
        return [];
    }
  };
}

/** Maps Anthropic usage (message_start or message_delta) to TokenUsage, skipping absent fields. */
function readUsage(raw: unknown): Partial<TokenUsage> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  const out: Partial<TokenUsage> = {};
  const map = [
    ['input_tokens', 'input'],
    ['output_tokens', 'output'],
    ['cache_read_input_tokens', 'cacheRead'],
    ['cache_creation_input_tokens', 'cacheWrite'],
  ] as const;
  for (const [from, to] of map) {
    if (typeof u[from] === 'number') out[to] = u[from];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Server tool errors arrive as HTTP 200 with an error object as `content`. */
function isServerToolError(content: unknown): boolean {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return false;
  const c = content as { type?: unknown; error_code?: unknown };
  return (typeof c.type === 'string' && c.type.endsWith('_error')) || c.error_code !== undefined;
}
