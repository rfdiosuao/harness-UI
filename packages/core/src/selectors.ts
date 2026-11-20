import {
  TERMINAL_TOOL_STATUSES,
  type AskPart,
  type HarnessError,
  type TokenUsage,
  type ToolCallPart,
  type TranscriptState,
} from './protocol';

/** Something the agent is blocked on until the user acts. */
export type PendingRequest =
  | { kind: 'permission'; messageId: string; part: ToolCallPart }
  | { kind: 'ask'; messageId: string; part: AskPart };

/** Every open permission request and question, in transcript order (oldest first). */
export function pendingRequests(state: TranscriptState): PendingRequest[] {
  const out: PendingRequest[] = [];
  for (const message of state.messages) {
    for (const part of message.parts) {
      if (part.kind === 'tool' && part.status === 'awaiting-permission') {
        out.push({ kind: 'permission', messageId: message.id, part });
      } else if (part.kind === 'ask' && part.status === 'pending') {
        out.push({ kind: 'ask', messageId: message.id, part });
      }
    }
  }
  return out;
}

/** Open permission requests only, oldest first. */
export function pendingPermissions(state: TranscriptState): ToolCallPart[] {
  return pendingRequests(state).flatMap((r) => (r.kind === 'permission' ? [r.part] : []));
}

/**
 * - `waiting`: blocked on the user (an approval or a question).
 * - `running`: a message is streaming or a tool call has not finished.
 * - `idle`: nothing in flight.
 */
export type RunStatus = 'idle' | 'running' | 'waiting';

export function runStatus(state: TranscriptState): RunStatus {
  let running = false;
  for (const message of state.messages) {
    if (message.streaming) running = true;
    for (const part of message.parts) {
      if (part.kind === 'tool') {
        if (part.status === 'awaiting-permission') return 'waiting';
        if (!TERMINAL_TOOL_STATUSES.has(part.status)) running = true;
      } else if (part.kind === 'ask' && part.status === 'pending') {
        return 'waiting';
      }
    }
  }
  return running ? 'running' : 'idle';
}

const ZERO: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function add(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/** Token totals per model (`unknown` when a message has no model), plus the overall total. */
export function usageTotals(state: TranscriptState): { total: TokenUsage; byModel: Record<string, TokenUsage> } {
  let total = ZERO;
  const byModel: Record<string, TokenUsage> = {};
  for (const { model = 'unknown', tokens } of Object.values(state.usage)) {
    total = add(total, tokens);
    byModel[model] = add(byModel[model] ?? ZERO, tokens);
  }
  return { total, byModel };
}

/**
 * Tokens the next request will carry, estimated from the latest assistant
 * message with usage: everything it read plus what it wrote.
 */
export function contextTokens(state: TranscriptState): number | undefined {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i]!;
    if (message.role !== 'assistant') continue;
    const u = state.usage[message.id]?.tokens;
    if (u) return u.input + u.cacheRead + u.cacheWrite + u.output;
  }
  return undefined;
}

/** The newest error still on screen (`active` or `retrying`), if any. */
export function activeError(state: TranscriptState): HarnessError | undefined {
  for (let i = state.errors.length - 1; i >= 0; i--) {
    const e = state.errors[i]!;
    if (e.status === 'active' || e.status === 'retrying') return e;
  }
  return undefined;
}
