import { parsePartialJson } from './partial-json';
import {
  TERMINAL_TOOL_STATUSES,
  type HarnessEvent,
  type Message,
  type Part,
  type PartKind,
  type ToolCallPart,
  type ToolStatus,
  type TranscriptState,
} from './protocol';

export const initialTranscript: TranscriptState = Object.freeze({
  messages: [],
  toolIndex: {},
  warnings: [],
}) as TranscriptState;

/** Legal tool status transitions. Anything else is ignored with a warning. */
const TRANSITIONS: Record<ToolStatus, readonly ToolStatus[]> = {
  'input-streaming': ['pending', 'error', 'interrupted'],
  pending: ['awaiting-permission', 'running', 'success', 'error', 'interrupted'],
  'awaiting-permission': ['running', 'denied', 'interrupted'],
  running: ['success', 'error', 'interrupted'],
  success: [],
  error: [],
  denied: [],
  interrupted: [],
};

export function canTransition(from: ToolStatus, to: ToolStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ToolStatus): boolean {
  return TERMINAL_TOOL_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Immutable update helpers
// ---------------------------------------------------------------------------

function warn(state: TranscriptState, message: string): TranscriptState {
  return { ...state, warnings: [...state.warnings, message] };
}

function findMessage(state: TranscriptState, messageId: string): number {
  // New events almost always target the latest message, so search backwards.
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i]!.id === messageId) return i;
  }
  return -1;
}

function replaceMessage(state: TranscriptState, index: number, message: Message): TranscriptState {
  const messages = state.messages.slice();
  messages[index] = message;
  return { ...state, messages };
}

function replacePart(message: Message, index: number, part: Part): Message {
  const parts = message.parts.slice();
  parts[index] = part;
  return { ...message, parts };
}

function updateTool(
  state: TranscriptState,
  toolCallId: string,
  update: (part: ToolCallPart) => ToolCallPart | string,
): TranscriptState {
  const loc = state.toolIndex[toolCallId];
  if (!loc) return warn(state, `Unknown toolCallId ${toolCallId}`);
  const message = state.messages[loc.message]!;
  const part = message.parts[loc.part] as ToolCallPart;
  const next = update(part);
  if (typeof next === 'string') return warn(state, next);
  return replaceMessage(state, loc.message, replacePart(message, loc.part, next));
}

function transition(
  part: ToolCallPart,
  to: ToolStatus,
  at: number | undefined,
  patch: Partial<ToolCallPart> = {},
): ToolCallPart | string {
  if (part.status === to) return { ...part, ...patch };
  if (!canTransition(part.status, to)) {
    return `Illegal tool transition ${part.status} → ${to} for ${part.toolCallId}`;
  }
  const timing =
    to === 'running' ? { runStartedAt: at } : isTerminal(to) ? { endedAt: at ?? part.endedAt } : {};
  return { ...part, ...patch, ...timing, status: to };
}

function ensureStreamPart(
  state: TranscriptState,
  messageId: string,
  partId: string,
  kind: PartKind,
  at: number | undefined,
): { state: TranscriptState; message: number; part: number } | string {
  const m = findMessage(state, messageId);
  if (m < 0) return `Unknown messageId ${messageId}`;
  const message = state.messages[m]!;
  const p = message.parts.findIndex((x) => x.id === partId);
  if (p >= 0) {
    if (message.parts[p]!.kind !== kind) return `Part ${partId} is not a ${kind} part`;
    return { state, message: m, part: p };
  }
  const part: Part =
    kind === 'thinking'
      ? { kind, id: partId, text: '', streaming: true, startedAt: at }
      : { kind, id: partId, text: '', streaming: true };
  const next = replaceMessage(state, m, { ...message, parts: [...message.parts, part] });
  return { state: next, message: m, part: message.parts.length };
}

function appendStreamText(
  state: TranscriptState,
  messageId: string,
  partId: string,
  kind: PartKind,
  delta: string,
  at: number | undefined,
): TranscriptState {
  const found = ensureStreamPart(state, messageId, partId, kind, at);
  if (typeof found === 'string') return warn(state, found);
  const message = found.state.messages[found.message]!;
  const part = message.parts[found.part] as Extract<Part, { kind: PartKind }>;
  return replaceMessage(
    found.state,
    found.message,
    replacePart(message, found.part, { ...part, text: part.text + delta }),
  );
}

function endPart(part: Part, at: number | undefined): Part {
  if (part.kind === 'tool' || !part.streaming) return part;
  if (part.kind === 'thinking') return { ...part, streaming: false, endedAt: at ?? part.endedAt };
  return { ...part, streaming: false };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Pure reducer from harness events to transcript state. Works with React's
 * `useReducer`, Redux, Zustand, or a plain `events.reduce(...)`.
 */
export function reduceTranscript(state: TranscriptState, event: HarnessEvent): TranscriptState {
  const { at } = event;

  switch (event.type) {
    case 'message.start': {
      if (findMessage(state, event.messageId) >= 0) {
        return warn(state, `Duplicate messageId ${event.messageId}`);
      }
      const message: Message = { id: event.messageId, role: event.role, parts: [], streaming: true };
      return { ...state, messages: [...state.messages, message] };
    }

    case 'message.end': {
      const m = findMessage(state, event.messageId);
      if (m < 0) return warn(state, `Unknown messageId ${event.messageId}`);
      const message = state.messages[m]!;
      const truncated = event.stopReason === 'max_tokens';
      const parts = message.parts.map((part): Part => {
        // A tool whose input never finished cannot run.
        if (part.kind === 'tool' && part.status === 'input-streaming') {
          return {
            ...part,
            status: truncated ? 'error' : 'interrupted',
            errorMessage: truncated ? 'Tool input was cut off (max_tokens)' : part.errorMessage,
            endedAt: at,
          };
        }
        return endPart(part, at);
      });
      return replaceMessage(state, m, {
        ...message,
        parts,
        streaming: false,
        stopReason: event.stopReason ?? null,
      });
    }

    case 'part.start': {
      const found = ensureStreamPart(state, event.messageId, event.partId, event.kind, at);
      return typeof found === 'string' ? warn(state, found) : found.state;
    }

    case 'part.end': {
      const m = findMessage(state, event.messageId);
      if (m < 0) return warn(state, `Unknown messageId ${event.messageId}`);
      const message = state.messages[m]!;
      const p = message.parts.findIndex((x) => x.id === event.partId);
      if (p < 0) return warn(state, `Unknown partId ${event.partId}`);
      return replaceMessage(state, m, replacePart(message, p, endPart(message.parts[p]!, at)));
    }

    case 'text.delta':
      return appendStreamText(state, event.messageId, event.partId, 'text', event.delta, at);

    case 'thinking.delta':
      return appendStreamText(state, event.messageId, event.partId, 'thinking', event.delta, at);

    case 'tool.start': {
      if (state.toolIndex[event.toolCallId]) {
        return warn(state, `Duplicate toolCallId ${event.toolCallId}`);
      }
      const m = findMessage(state, event.messageId);
      if (m < 0) return warn(state, `Unknown messageId ${event.messageId}`);
      const message = state.messages[m]!;
      const part: ToolCallPart = {
        kind: 'tool',
        id: event.partId,
        toolCallId: event.toolCallId,
        name: event.name,
        status: 'input-streaming',
        inputText: '',
        input: undefined,
        output: '',
        startedAt: at,
      };
      const next = replaceMessage(state, m, { ...message, parts: [...message.parts, part] });
      return {
        ...next,
        toolIndex: { ...next.toolIndex, [event.toolCallId]: { message: m, part: message.parts.length } },
      };
    }

    case 'tool.input.delta':
      return updateTool(state, event.toolCallId, (part) => {
        if (part.status !== 'input-streaming') {
          return `Input delta after input ended for ${part.toolCallId}`;
        }
        const inputText = part.inputText + event.delta;
        const parsed = parsePartialJson(inputText);
        return {
          ...part,
          inputText,
          // Keep the last good value if this chunk is momentarily unparseable.
          input: parsed.error ? part.input : parsed.value,
          inputError: parsed.error,
        };
      });

    case 'tool.input.end':
      return updateTool(state, event.toolCallId, (part) => {
        // Tools with no parameters stream no input at all.
        const text = part.inputText.trim() === '' ? '{}' : part.inputText;
        try {
          return transition(part, 'pending', at, { input: JSON.parse(text), inputError: undefined });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return transition(part, 'error', at, {
            inputError: message,
            errorMessage: `Invalid tool input: ${message}`,
          });
        }
      });

    case 'tool.permission.request':
      return updateTool(state, event.toolCallId, (part) =>
        transition(part, 'awaiting-permission', at, {
          permission: { risk: event.risk, reason: event.reason },
        }),
      );

    case 'tool.permission.resolve':
      return updateTool(state, event.toolCallId, (part) =>
        transition(part, event.decision === 'allow' ? 'running' : 'denied', at, {
          permission: { ...part.permission, decision: event.decision, scope: event.scope ?? 'once' },
        }),
      );

    case 'tool.run':
      return updateTool(state, event.toolCallId, (part) => transition(part, 'running', at));

    case 'tool.output.delta':
      return updateTool(state, event.toolCallId, (part) => {
        if (part.status !== 'running') return `Output delta while ${part.status} for ${part.toolCallId}`;
        return { ...part, output: part.output + event.delta };
      });

    case 'tool.result':
      return updateTool(state, event.toolCallId, (part) =>
        transition(part, event.isError ? 'error' : 'success', at, {
          result: event.output,
          errorMessage: event.isError && typeof event.output === 'string' ? event.output : part.errorMessage,
        }),
      );

    case 'tool.interrupt':
      return updateTool(state, event.toolCallId, (part) =>
        transition(part, 'interrupted', at, { errorMessage: event.reason ?? part.errorMessage }),
      );

    default: {
      const unknown: { type?: unknown } = event;
      return warn(state, `Unknown event type ${String(unknown.type)}`);
    }
  }
}

/** Convenience for replaying a recorded event log. */
export function replay(events: Iterable<HarnessEvent>, from: TranscriptState = initialTranscript) {
  let state = from;
  for (const event of events) state = reduceTranscript(state, event);
  return state;
}
