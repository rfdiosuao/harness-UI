import { parsePartialJson } from './partial-json';
import {
  TERMINAL_TOOL_STATUSES,
  type AskAnswer,
  type AskPart,
  type FallbackPart,
  type HarnessError,
  type TokenUsage,
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
  askIndex: {},
  queue: [],
  usage: {},
  errors: [],
  warnings: [],
}) as TranscriptState;

const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const USAGE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

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

function updateAsk(
  state: TranscriptState,
  askId: string,
  update: (part: AskPart) => AskPart | string,
): TranscriptState {
  const loc = state.askIndex[askId];
  if (!loc) return warn(state, `Unknown askId ${askId}`);
  const message = state.messages[loc.message]!;
  const part = message.parts[loc.part] as AskPart;
  const next = update(part);
  if (typeof next === 'string') return warn(state, next);
  return replaceMessage(state, loc.message, replacePart(message, loc.part, next));
}

/** Checks an answer against its question; returns the cleaned answer or an error. */
export function validateAskAnswer(part: AskPart, answer: AskAnswer): AskAnswer | string {
  const known = new Set(part.options.map((o) => o.id));
  const selected = [...new Set(answer.selected)];
  const unknown = selected.filter((id) => !known.has(id));
  if (unknown.length > 0) return `Ask ${part.askId}: unknown option ${unknown.join(', ')}`;
  const other = answer.other?.trim() || undefined;
  if (other && !part.allowOther) return `Ask ${part.askId} does not accept a free-text answer`;
  const count = selected.length + (other ? 1 : 0);
  if (count === 0) return `Ask ${part.askId}: empty answer`;
  if (!part.multiSelect && count > 1) return `Ask ${part.askId} is single-select but got ${count} answers`;
  return other ? { selected, other } : { selected };
}

function interruptAll(state: TranscriptState, reason: string | undefined, at: number | undefined): TranscriptState {
  const why = reason ?? 'Interrupted by user';
  let changed = false;
  const messages = state.messages.map((message) => {
    let partsChanged = false;
    const parts = message.parts.map((part): Part => {
      if (part.kind === 'tool' && !isTerminal(part.status)) {
        partsChanged = true;
        return { ...part, status: 'interrupted', errorMessage: why, endedAt: at ?? part.endedAt };
      }
      if (part.kind === 'ask' && part.status === 'pending') {
        partsChanged = true;
        return { ...part, status: 'cancelled', cancelReason: why };
      }
      if (message.streaming) {
        const ended = endPart(part, at);
        if (ended !== part) partsChanged = true;
        return ended;
      }
      return part;
    });
    if (!partsChanged && !message.streaming) return message;
    changed = true;
    return message.streaming ? { ...message, parts, streaming: false, stopReason: 'interrupted' } : { ...message, parts };
  });
  return changed ? { ...state, messages } : state;
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
  if (part.kind !== 'text' && part.kind !== 'thinking') return part;
  if (!part.streaming) return part;
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
      const message: Message = { id: event.messageId, role: event.role, parts: [], streaming: true, model: event.model };
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
          permission: {
            ...part.permission,
            decision: event.decision,
            scope: event.scope ?? 'once',
            rule: event.scope === 'always' ? event.rule : undefined,
          },
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

    case 'ask.request': {
      if (state.askIndex[event.askId]) return warn(state, `Duplicate askId ${event.askId}`);
      if (event.options.length === 0 && !event.allowOther) {
        return warn(state, `Ask ${event.askId} has no options and no free-text answer`);
      }
      const m = findMessage(state, event.messageId);
      if (m < 0) return warn(state, `Unknown messageId ${event.messageId}`);
      const message = state.messages[m]!;
      const part: AskPart = {
        kind: 'ask',
        id: event.partId,
        askId: event.askId,
        question: event.question,
        header: event.header,
        options: event.options,
        multiSelect: !!event.multiSelect,
        allowOther: !!event.allowOther,
        status: 'pending',
        toolCallId: event.toolCallId,
        askedAt: at,
      };
      const next = replaceMessage(state, m, { ...message, parts: [...message.parts, part] });
      return { ...next, askIndex: { ...next.askIndex, [event.askId]: { message: m, part: message.parts.length } } };
    }

    case 'ask.answer':
      return updateAsk(state, event.askId, (part) => {
        if (part.status !== 'pending') return `Ask ${part.askId} is already ${part.status}`;
        const answer = validateAskAnswer(part, event.answer);
        if (typeof answer === 'string') return answer;
        return { ...part, status: 'answered', answer, answeredAt: at };
      });

    case 'ask.cancel':
      return updateAsk(state, event.askId, (part) => {
        if (part.status !== 'pending') return `Ask ${part.askId} is already ${part.status}`;
        return { ...part, status: 'cancelled', cancelReason: event.reason };
      });

    case 'turn.interrupt':
      return interruptAll(state, event.reason, at);

    case 'queue.add': {
      if (state.queue.some((q) => q.id === event.queueId)) return warn(state, `Duplicate queueId ${event.queueId}`);
      if (event.text.trim() === '') return warn(state, `Queued message ${event.queueId} is empty`);
      return { ...state, queue: [...state.queue, { id: event.queueId, text: event.text, at }] };
    }

    case 'queue.remove': {
      if (!state.queue.some((q) => q.id === event.queueId)) return warn(state, `Unknown queueId ${event.queueId}`);
      return { ...state, queue: state.queue.filter((q) => q.id !== event.queueId) };
    }

    case 'usage': {
      const prev = state.usage[event.messageId];
      const tokens: TokenUsage = { ...(prev?.tokens ?? ZERO_USAGE) };
      for (const key of USAGE_KEYS) {
        const value = event.usage[key];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) tokens[key] = value;
      }
      const m = findMessage(state, event.messageId);
      const model = event.model ?? prev?.model ?? (m >= 0 ? state.messages[m]!.model : undefined);
      return { ...state, usage: { ...state.usage, [event.messageId]: { model, tokens } } };
    }

    case 'model.fallback': {
      const m = findMessage(state, event.messageId);
      if (m < 0) return warn(state, `Unknown messageId ${event.messageId}`);
      const message = state.messages[m]!;
      const part: FallbackPart = { kind: 'fallback', id: event.partId, from: event.from, to: event.to, at };
      return replaceMessage(state, m, { ...message, model: event.to, parts: [...message.parts, part] });
    }

    case 'error': {
      const { type: _, errorId, retryable, ...rest } = event;
      const index = state.errors.findIndex((e) => e.id === errorId);
      const prev = state.errors[index];
      const next: HarnessError = {
        ...prev,
        ...rest,
        id: errorId,
        status: 'active',
        retryable: retryable ?? prev?.retryable ?? false,
        // A new report without a retry time cancels the old schedule.
        retryAt: event.retryAt,
        at: prev?.at ?? at,
      };
      const errors = state.errors.slice();
      if (index >= 0) errors[index] = next;
      else errors.push(next);
      return { ...state, errors };
    }

    case 'error.retry':
    case 'error.resolve': {
      const index = state.errors.findIndex((e) => e.id === event.errorId);
      if (index < 0) return warn(state, `Unknown errorId ${event.errorId}`);
      const prev = state.errors[index]!;
      if (prev.status === 'resolved' || prev.status === 'dismissed') {
        return warn(state, `Error ${event.errorId} is already ${prev.status}`);
      }
      const next: HarnessError =
        event.type === 'error.retry'
          ? { ...prev, status: 'retrying', retryAt: undefined, attempt: event.attempt ?? (prev.attempt ?? 1) + 1 }
          : { ...prev, status: event.outcome === 'dismissed' ? 'dismissed' : 'resolved', retryAt: undefined };
      const errors = state.errors.slice();
      errors[index] = next;
      return { ...state, errors };
    }

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
