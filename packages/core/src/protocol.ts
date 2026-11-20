/**
 * The harnesskit event protocol.
 *
 * Every UI component consumes state derived from this one stream of events.
 * Provider adapters (see `./adapters`) translate model-provider stream events
 * into these; the harness itself emits the tool lifecycle events that no
 * model provider knows about (permission, run, output, result).
 *
 * All events may carry `at` (epoch ms). The reducer never reads the clock, so
 * replaying a recorded event log always produces the same transcript.
 */

export type Role = 'user' | 'assistant';

export type PartKind = 'text' | 'thinking';

/**
 * Tool call lifecycle.
 *
 * ```
 * input-streaming ─▶ pending ─┬─▶ awaiting-permission ─┬─▶ running ─┬─▶ success
 *        │                    │                        └─▶ denied   └─▶ error
 *        └─▶ error            └─▶ running / success / error
 * any non-terminal state ─▶ interrupted
 * ```
 */
export type ToolStatus =
  | 'input-streaming'
  | 'pending'
  | 'awaiting-permission'
  | 'running'
  | 'success'
  | 'error'
  | 'denied'
  | 'interrupted';

export type RiskLevel = 'low' | 'medium' | 'high';

export type PermissionDecision = 'allow' | 'deny';

/** `always` asks the harness to remember the decision for similar calls. */
export type PermissionScope = 'once' | 'always';

export interface AskOption {
  id: string;
  label: string;
  description?: string;
  /** Shown first and marked as the agent's suggestion. */
  recommended?: boolean;
}

export interface AskAnswer {
  /** Ids of the chosen options. */
  selected: string[];
  /** Free-text answer, when the question allows one. */
  other?: string;
}

export type AskStatus = 'pending' | 'answered' | 'cancelled';

interface Base {
  /** Epoch milliseconds. Optional; used for durations only. */
  at?: number;
}

export type HarnessEvent =
  | (Base & { type: 'message.start'; messageId: string; role: Role })
  | (Base & { type: 'message.end'; messageId: string; stopReason?: string | null })
  | (Base & { type: 'part.start'; messageId: string; partId: string; kind: PartKind })
  | (Base & { type: 'part.end'; messageId: string; partId: string })
  | (Base & { type: 'text.delta'; messageId: string; partId: string; delta: string })
  | (Base & { type: 'thinking.delta'; messageId: string; partId: string; delta: string })
  | (Base & { type: 'tool.start'; messageId: string; partId: string; toolCallId: string; name: string })
  | (Base & { type: 'tool.input.delta'; toolCallId: string; delta: string })
  | (Base & { type: 'tool.input.end'; toolCallId: string })
  | (Base & { type: 'tool.permission.request'; toolCallId: string; risk?: RiskLevel; reason?: string })
  | (Base & {
      type: 'tool.permission.resolve';
      toolCallId: string;
      decision: PermissionDecision;
      scope?: PermissionScope;
      /** With `scope: 'always'`: the rule the harness should remember, e.g. `bash(npm run *)`. */
      rule?: string;
    })
  | (Base & { type: 'tool.run'; toolCallId: string })
  | (Base & { type: 'tool.output.delta'; toolCallId: string; delta: string })
  | (Base & { type: 'tool.result'; toolCallId: string; output?: unknown; isError?: boolean })
  | (Base & { type: 'tool.interrupt'; toolCallId: string; reason?: string })
  | (Base & {
      type: 'ask.request';
      messageId: string;
      partId: string;
      askId: string;
      question: string;
      /** Short label, e.g. "CI provider". */
      header?: string;
      options: AskOption[];
      multiSelect?: boolean;
      /** Offer a free-text answer next to the options. */
      allowOther?: boolean;
      /** When the question came from a tool call (e.g. an `ask_user` tool), its id. */
      toolCallId?: string;
    })
  | (Base & { type: 'ask.answer'; askId: string; answer: AskAnswer })
  | (Base & { type: 'ask.cancel'; askId: string; reason?: string })
  /**
   * The user stopped the agent. Ends streaming messages, interrupts every
   * unfinished tool call, and cancels pending questions.
   */
  | (Base & { type: 'turn.interrupt'; reason?: string })
  /** A message the user typed while the agent was busy, waiting to be sent. */
  | (Base & { type: 'queue.add'; queueId: string; text: string })
  | (Base & { type: 'queue.remove'; queueId: string });

export type HarnessEventType = HarnessEvent['type'];

// ---------------------------------------------------------------------------
// Derived transcript state
// ---------------------------------------------------------------------------

export interface TextPart {
  kind: 'text';
  id: string;
  text: string;
  streaming: boolean;
}

export interface ThinkingPart {
  kind: 'thinking';
  id: string;
  /** May stay empty when the provider hides reasoning; render a duration instead. */
  text: string;
  streaming: boolean;
  startedAt?: number;
  endedAt?: number;
}

export interface ToolPermission {
  risk?: RiskLevel;
  reason?: string;
  decision?: PermissionDecision;
  scope?: PermissionScope;
  rule?: string;
}

export interface ToolCallPart {
  kind: 'tool';
  id: string;
  toolCallId: string;
  name: string;
  status: ToolStatus;
  /** Raw (possibly incomplete) JSON text of the tool input. */
  inputText: string;
  /** Best-effort parse of `inputText`; fills in progressively while streaming. */
  input: unknown;
  inputError?: string;
  permission?: ToolPermission;
  /** Streamed output (e.g. terminal lines), appended by `tool.output.delta`. */
  output: string;
  /** Final structured result from `tool.result`. */
  result?: unknown;
  /** Why the call ended in `error` or `interrupted`, when known. */
  errorMessage?: string;
  /** When the model started emitting the call. */
  startedAt?: number;
  /** When execution began (entered `running`). Excludes time spent awaiting approval. */
  runStartedAt?: number;
  endedAt?: number;
}

export interface AskPart {
  kind: 'ask';
  id: string;
  askId: string;
  question: string;
  header?: string;
  options: AskOption[];
  multiSelect: boolean;
  allowOther: boolean;
  status: AskStatus;
  answer?: AskAnswer;
  cancelReason?: string;
  toolCallId?: string;
  askedAt?: number;
  answeredAt?: number;
}

export type Part = TextPart | ThinkingPart | ToolCallPart | AskPart;

export interface QueuedMessage {
  id: string;
  text: string;
  at?: number;
}

export interface Message {
  id: string;
  role: Role;
  parts: Part[];
  streaming: boolean;
  stopReason?: string | null;
}

export interface TranscriptState {
  messages: Message[];
  /** toolCallId → position, for O(1) tool event routing. */
  toolIndex: Record<string, { message: number; part: number }>;
  /** askId → position. */
  askIndex: Record<string, { message: number; part: number }>;
  /** Messages the user queued while the agent was busy, oldest first. */
  queue: QueuedMessage[];
  /** Events the reducer ignored (unknown ids, illegal transitions). Useful in dev. */
  warnings: string[];
}

export const TERMINAL_TOOL_STATUSES: ReadonlySet<ToolStatus> = new Set([
  'success',
  'error',
  'denied',
  'interrupted',
]);
