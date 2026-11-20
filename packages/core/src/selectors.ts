import { TERMINAL_TOOL_STATUSES, type AskPart, type ToolCallPart, type TranscriptState } from './protocol';

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
