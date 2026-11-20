import {
  type Message,
  type PermissionDecision,
  type PermissionScope,
  type TextPart,
  type ThinkingPart,
} from '@harnesskit/core';
import { createAnthropicAdapter } from '@harnesskit/core/anthropic';
import { formatDuration, StreamingMarkdown, ToolCallCard, useTranscript } from '@harnesskit/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { galleryParts } from './gallery';
import { MarkdownDemo } from './MarkdownDemo';
import { buildScenario, type Step } from './scenario';

type Phase = 'playing' | 'gated' | 'done';
const SPEEDS = [1, 2, 4] as const;

function useReplay() {
  const { state, dispatch, reset } = useTranscript();
  const scenario = useMemo(buildScenario, []);
  const [phase, setPhase] = useState<Phase>('playing');
  const [gate, setGate] = useState<string | null>(null);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  const queue = useRef<Step[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const adapter = useRef(createAnthropicAdapter());
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const tick = useCallback(() => {
    const step = queue.current.shift();
    if (!step) {
      setPhase('done');
      return;
    }
    if (step.kind === 'gate') {
      setGate(step.toolCallId);
      setPhase('gated');
      return;
    }
    if (step.kind === 'model') dispatch(adapter.current(step.event));
    else dispatch({ ...step.event, at: Date.now() });
    timer.current = window.setTimeout(tick, step.delay / speedRef.current);
  }, [dispatch]);

  const restart = useCallback(() => {
    window.clearTimeout(timer.current);
    reset();
    adapter.current = createAnthropicAdapter();
    queue.current = [...scenario.main];
    setGate(null);
    setPhase('playing');
    timer.current = window.setTimeout(tick, 300);
  }, [reset, scenario, tick]);

  const decide = useCallback(
    (toolCallId: string, decision: PermissionDecision, scope: PermissionScope) => {
      if (toolCallId !== gate) return;
      dispatch({ type: 'tool.permission.resolve', toolCallId, decision, scope, at: Date.now() });
      queue.current = [...(decision === 'allow' ? scenario.allow : scenario.deny)];
      setGate(null);
      setPhase('playing');
      timer.current = window.setTimeout(tick, 200);
    },
    [dispatch, gate, scenario, tick],
  );

  useEffect(() => {
    restart();
    return () => window.clearTimeout(timer.current);
  }, [restart]);

  return { state, phase, gate, decide, restart, speed, setSpeed };
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

function Text({ part }: { part: TextPart }) {
  return <StreamingMarkdown text={part.text} streaming={part.streaming} />;
}

function MessageView({
  message,
  gate,
  onDecide,
}: {
  message: Message;
  gate: string | null;
  onDecide: (toolCallId: string, d: PermissionDecision, s: PermissionScope) => void;
}) {
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
            return <Text key={part.id} part={part} />;
          case 'tool':
            return (
              <ToolCallCard
                key={part.id}
                part={part}
                onPermission={
                  part.toolCallId === gate ? (d, s) => onDecide(part.toolCallId, d, s) : undefined
                }
              />
            );
        }
      })}
    </div>
  );
}

export function App() {
  const { state, phase, gate, decide, restart, speed, setSpeed } = useReplay();
  const toolCount = Object.keys(state.toolIndex).length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-8">
        <p className="font-mono text-xs text-hk-muted">@harnesskit/react · v0.0.0</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">harnesskit playground</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-hk-muted">
          A scripted agent run streamed through the real Anthropic adapter and transcript reducer. It pauses
          when a tool needs approval; what you click decides how it continues.
        </p>
      </header>

      <section aria-labelledby="replay-title">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 id="replay-title" className="mr-auto text-sm font-semibold">
            Live replay
          </h2>
          <span className="text-xs text-hk-muted" aria-live="polite">
            {phase === 'gated' ? 'Waiting for your approval' : phase === 'done' ? 'Finished' : 'Streaming…'}
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
          <button
            type="button"
            onClick={restart}
            className="rounded-md border border-hk-border px-2.5 py-1 text-xs font-medium hover:bg-hk-subtle"
          >
            Restart
          </button>
        </div>

        <div className="min-h-[28rem] space-y-5 rounded-xl border border-hk-border bg-hk-surface/60 p-4 sm:p-5">
          {state.messages.map((m) => (
            <MessageView key={m.id} message={m} gate={gate} onDecide={decide} />
          ))}
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
          {galleryParts.map(({ status, part }) => (
            <div key={status} className="grid gap-1.5 sm:grid-cols-[9.5rem_1fr] sm:gap-3">
              <code className="pt-2 font-mono text-xs text-hk-muted">{status}</code>
              <ToolCallCard part={part} onPermission={() => {}} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
