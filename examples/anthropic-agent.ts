/**
 * Wiring harnesskit to a Claude agent loop.
 *
 * The adapter turns Anthropic stream events into harnesskit events; your
 * harness adds the tool lifecycle (approval, execution, result). Feed every
 * event to `dispatch` from `useTranscript()` (or any store using
 * `reduceTranscript`) and render with the components.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { HarnessEvent, PermissionDecision } from '@harnesskit/core';
import { createAnthropicAdapter } from '@harnesskit/core/anthropic';

const client = new Anthropic();

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: 'bash',
    description: 'Run a shell command in the project directory.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
      additionalProperties: false,
    },
    // Stream tool input as it is generated so the UI can show it live.
    eager_input_streaming: true,
  },
];

export async function runTurn(
  messages: Anthropic.Beta.BetaMessageParam[],
  dispatch: (events: HarnessEvent[]) => void,
  askPermission: (toolCallId: string) => Promise<PermissionDecision>,
  execute: (command: string, onOutput: (chunk: string) => void) => Promise<string>,
) {
  const translate = createAnthropicAdapter();
  const stream = client.beta.messages.stream({
    model: 'claude-opus-5-5',
    max_tokens: 64000,
    thinking: { type: 'adaptive', display: 'summarized' },
    // On a policy decline, the API retries on a fallback model in the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    tools,
    messages,
  });

  for await (const event of stream) dispatch(translate(event));
  const message = await stream.finalMessage();
  if (message.stop_reason !== 'tool_use') return message;

  const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
  for (const block of message.content) {
    if (block.type !== 'tool_use') continue;
    const id = block.id;
    const input = block.input as { command?: unknown };
    if (typeof input.command !== 'string') {
      dispatch([{ type: 'tool.result', toolCallId: id, isError: true, output: 'Invalid input: command must be a string' }]);
      results.push({ type: 'tool_result', tool_use_id: id, is_error: true, content: 'Invalid input: command must be a string' });
      continue;
    }

    dispatch([{ type: 'tool.permission.request', toolCallId: id, risk: 'medium', at: Date.now() }]);
    const decision = await askPermission(id);
    dispatch([{ type: 'tool.permission.resolve', toolCallId: id, decision, at: Date.now() }]);
    if (decision === 'deny') {
      results.push({ type: 'tool_result', tool_use_id: id, is_error: true, content: 'The user denied this command.' });
      continue;
    }

    try {
      const output = await execute(input.command, (chunk) =>
        dispatch([{ type: 'tool.output.delta', toolCallId: id, delta: chunk }]),
      );
      dispatch([{ type: 'tool.result', toolCallId: id, output, at: Date.now() }]);
      results.push({ type: 'tool_result', tool_use_id: id, content: output });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      dispatch([{ type: 'tool.result', toolCallId: id, isError: true, output: text, at: Date.now() }]);
      results.push({ type: 'tool_result', tool_use_id: id, is_error: true, content: text });
    }
  }

  messages.push({ role: 'assistant', content: message.content }, { role: 'user', content: results });
  return runTurn(messages, dispatch, askPermission, execute);
}
