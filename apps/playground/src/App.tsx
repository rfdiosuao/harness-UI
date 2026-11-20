import {
  pendingPermissions,
  runStatus,
  type AskAnswer,
  type Message,
  type PermissionDecision,
  type PermissionScope,
  type TextPart,
  type ThinkingPart,
} from '@harnesskit/core';
import { createAnthropicAdapter } from '@harnesskit/core/anthropic';
import {
  AskUserCard,
  Button,
  formatDuration,
  InterruptBar,
  PermissionPrompt,
  StreamingMarkdown,
  ToolCallCard,
  useTranscript,
} from '@harnesskit/react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { galleryParts } from './gallery';
import { MarkdownDemo } from './MarkdownDemo';
import { buildScenario, followUp, type Step } from './scenario';

type Phase = 'playing' | 'waiting' | 'done';
const SPEEDS = [1, 2, 4] as const;

/**
 * Plays a scenario through the real adapter and reducer. `wait` steps pause
 * until the transcript says the user acted; `then` steps build what happens
 * next from the transcript, so the story follows the user's choices.
 */
function useReplay() {
  const { state, dispatch, reset } = useTranscript();
  const [phase, setPhase] = useState<Phase>('playing');
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  const queue = useRef<Step[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const adapter = useRef(createAnthropicAdapter());
  const stateRef = useRef(state);
  const phaseRef = useRef(phase);
  const speedRef = useRef(speed);
  const followUps = useRef(0);
  stateRef.current = state;
  phaseRef.current = phase;
  speedRef.current = speed;

  const setPhaseNow = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const tick = useCallback(() => {
    window.clearTimeout(timer.current);
    for (;;) {
      const step = queue.current[0];
      if (!step) return setPhaseNow('done');
      if (step.kind === 'wait') {
        if (!step.until(stateRef.current)) return setPhaseNow('waiting');
        queue.current.shift();
        continue;
      }
      if (step.kind === 'then') {
        queue.current.shift();
        queue.current.unshift(...step.next(stateRef.current));
        continue;
      }
      queue.current.shift();
      if (step.kind === 'model') dispatch(adapter.current(step.event));
      else dispatch({ ...step.event, at: Date.now() });
      setPhaseNow('playing');
      timer.current = window.setTimeout(tick, step.delay / speedRef.current);
      return;
    }
  }, [dispatch]);

  const play = useCallback(
    (steps: Step[]) => {
      queue.current = [...steps];
      setPhaseNow('playing');
      timer.current = window.setTimeout(tick, 200);
    },
    [tick],
  );

  const restart = useCallback(() => {
    window.clearTimeout(timer.current);
    reset();
    adapter.current = createAnthropicAdapter();
    followUps.current = 0;
    play(buildScenario());
  }, [play, reset]);

  // A `wait` step re-checks whenever the transcript changes.
  useEffect(() => {
    if (phaseRef.current === 'waiting') tick();
  }, [state, tick]);

  // When the run ends, send the oldest queued message.
  useEffect(() => {
    const next = state.queue[0];
    if (phase !== 'done' || !next) return;
    dispatch({ type: 'queue.remove', queueId: next.id });
    play(followUp(++followUps.current, next.text));
  }, [phase, state.queue, dispatch, play]);

  useEffect(() => {
    restart();
    return () => window.clearTimeout(timer.current);
  }, [restart]);

  const interrupt = useCallback(() => {
    window.clearTimeout(timer.current);
    queue.current = [];
    dispatch({ type: 'turn.interrupt', at: Date.now() });
    setPhaseNow('done');
  }, [dispatch]);

  const send = useCallback(
    (text: string) => {
      if (phaseRef.current === 'done') play(followUp(++followUps.current, text));
      else dispatch({ type: 'queue.add', queueId: `q${Date.now()}`, text, at: Date.now() });
    },
    [dispatch, play],
  );

  return { state, dispatch, phase, restart, interrupt, send, speed, setSpeed };
}

function useRunStartedAt(active: boolean) {
  const [startedAt, setStartedAt] = useState<number | undefined>();
  useEffect(() => setStartedAt(active ? Date.now() : undefined), [active]);
  return startedAt;
}

function Thinking({ part }: { part: ThinkingPart }) {
  const duration =
    part.startedAt !== undefined && part.endedAt !== undefined ? formatDuration(part.endedAt - part.startedAt) : null;
  return (
    <details className="group text-sm text-hk-muted">
      <summary className="cursor-pointer list-none select-none hover:text-hk-fg [&::-webkit-details-marker]:hidden">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
        {part.streaming ? 'Thinking…' : `Thought for ${duration ?? 'a moment'}`}
      </summary>
      <p className="mt-1.5 border-l-2 border-hk-border pl-3 leading-relaxed whitespace-pre-wrap">{part.text}</p>
    </details>
  );
}

function MessageView({ message, onAnswer }: { message: Message; onAnswer: (askId: string, answer: AskAnswer) => void }) {
  if (message.role === 'user') {
    const text = message.parts.find((p): p is TextPart => p.kind === 'text')?.text ?? '';
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-hk-subtle px-3.5 py-2 leading-relaxed">{text}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {message.parts.map((part) => {
        switch (part.kind) {
          case 'thinking':
            return <Thinking key={part.id} part={part} />;
          case 'text':
            return <StreamingMarkdown key={part.id} text={part.text} streaming={part.streaming} />;
          case 'tool':
            // Approvals happen in the docked PermissionPrompt, so cards are read-only.
            return <ToolCallCard key={part.id} part={part} />;
          case 'ask':
            return <AskUserCard key={part.id} part={part} onAnswer={onAnswer} />;
        }
      })}
    </div>
  );
}

function Composer({ onSend, busy }: { onSend: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() === '') {
      setError('Type a message first.');
      return;
    }
    onSend(text.trim());
    setText('');
  };
  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          aria-label="Message"
          aria-invalid={!!error || undefined}
          placeholder={busy ? 'Also update the README' : 'Add a lint step too'}
          className="h-9 min-w-0 flex-1 rounded-md border border-hk-border bg-hk-surface px-3 text-sm outline-none placeholder:text-hk-muted focus:border-hk-accent"
        />
        <Button type="submit" variant="secondary" className="h-9">
          {busy ? 'Queue' : 'Send'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-hk-danger">
          {error}
        </p>
      )}
    </form>
  );
}

export function App() {
  const { state, dispatch, phase, restart, interrupt, send, speed, setSpeed } = useReplay();
  const status = runStatus(state);
  const permissions = useMemo(() => pendingPermissions(state), [state]);
  const startedAt = useRunStartedAt(status !== 'idle');
  const toolCount = Object.keys(state.toolIndex).length;

  const onResolve = useCallback(
    (toolCallId: string, decision: PermissionDecision, scope: PermissionScope, rule?: string) =>
      dispatch({ type: 'tool.permission.resolve', toolCallId, decision, scope, rule, at: Date.now() }),
    [dispatch],
  );
  const onAnswer = useCallback(
    (askId: string, answer: AskAnswer) => dispatch({ type: 'ask.answer', askId, answer, at: Date.now() }),
    [dispatch],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-8">
        <p className="font-mono text-xs text-hk-muted">@harnesskit/react · v0.0.0</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">harnesskit playground</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-hk-muted">
          A scripted agent run streamed through the real Anthropic adapter and transcript reducer. The agent asks
          you questions, waits for your approvals, and adapts to what you choose. Press Esc at any point to stop it,
          or queue a message while it works.
        </p>
      </header>

      <section aria-labelledby="replay-title">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 id="replay-title" className="mr-auto text-sm font-semibold">
            Live replay
          </h2>
          <span className="text-xs text-hk-muted" aria-live="polite">
            {phase === 'waiting' ? 'Waiting for you' : phase === 'done' ? 'Finished' : 'Streaming…'}
          </span>
          <div role="group" aria-label="Playback speed" className="flex rounded-md border border-hk-border p-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
                className="rounded px-2 py-0.5 text-xs tabular-nums text-hk-muted aria-pressed:bg-hk-subtle aria-pressed:text-hk-fg"
              >
                {s}×
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={restart}>
            Restart
          </Button>
        </div>

        <div className="rounded-xl border border-hk-border bg-hk-surface/60">
          <div className="min-h-[24rem] space-y-5 p-4 sm:p-5">
            {state.messages.map((m) => (
              <MessageView key={m.id} message={m} onAnswer={onAnswer} />
            ))}
          </div>
          <div className="sticky bottom-0 space-y-2 rounded-b-xl border-t border-hk-border bg-hk-bg/95 p-3 backdrop-blur sm:p-4">
            <PermissionPrompt requests={permissions} onResolve={onResolve} />
            <InterruptBar
              status={status}
              onInterrupt={interrupt}
              queue={state.queue}
              onRemoveQueued={(queueId) => dispatch({ type: 'queue.remove', queueId })}
              startedAt={startedAt}
            />
            <Composer onSend={send} busy={phase !== 'done'} />
          </div>
        </div>

        <p className="mt-2 font-mono text-[11px] text-hk-muted">
          {state.messages.length} messages · {toolCount} tool calls · {state.warnings.length} reducer warnings
        </p>
      </section>

      <MarkdownDemo />

      <section aria-labelledby="states-title" className="mt-14">
        <h2 id="states-title" className="text-sm font-semibold">
          Every state
        </h2>
        <p className="mt-1 mb-4 text-sm text-hk-muted">
          The ToolCallCard lifecycle. Cards that need attention open themselves; click any header to toggle.
        </p>
        <div className="space-y-2">
          {galleryParts.map(({ status: s, part }) => (
            <div key={s} className="grid gap-1.5 sm:grid-cols-[9.5rem_1fr] sm:gap-3">
              <code className="pt-2 font-mono text-xs text-hk-muted">{s}</code>
              <ToolCallCard part={part} onPermission={() => {}} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
