import type { QueuedMessage, RunStatus } from '@harnesskit/core';
import { CornerDownRight, LoaderCircle, Square, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';
import { cx, formatDuration } from './utils';

export interface InterruptBarLabels {
  running: string;
  waiting: string;
  stop: string;
  queued: string;
  removeQueued: string;
  queueHint: string;
}

export const defaultInterruptBarLabels: InterruptBarLabels = {
  running: 'Working…',
  waiting: 'Waiting for you',
  stop: 'Stop',
  queued: 'Queued',
  removeQueued: 'Remove queued message',
  queueHint: 'Sends when the agent is ready',
};

export interface InterruptBarProps {
  /** From `runStatus(state)` in core. */
  status: RunStatus;
  onInterrupt: () => void;
  /** Messages typed while the agent was busy; from `state.queue`. */
  queue?: readonly QueuedMessage[];
  onRemoveQueued?: (queueId: string) => void;
  /** When the current run began (epoch ms), for the elapsed timer. */
  startedAt?: number;
  /** Stop on `Escape` anywhere on the page while running. On by default. */
  escapeToStop?: boolean;
  labels?: Partial<InterruptBarLabels>;
  className?: string;
}

/**
 * Shows that the agent is busy, lets the user stop it (button or `Escape`),
 * and lists messages queued for when it's ready. Renders nothing when the
 * agent is idle and the queue is empty.
 *
 * `Escape` is ignored during IME composition, on key repeat, and when
 * another handler already called `preventDefault()` (e.g. a menu closing).
 */
export function InterruptBar({
  status,
  onInterrupt,
  queue = [],
  onRemoveQueued,
  startedAt,
  escapeToStop = true,
  labels: overrides,
  className,
}: InterruptBarProps) {
  const labels = { ...defaultInterruptBarLabels, ...overrides };
  const active = status !== 'idle';
  const elapsed = useElapsed(active ? startedAt : undefined);

  const onInterruptRef = useRef(onInterrupt);
  onInterruptRef.current = onInterrupt;

  useEffect(() => {
    if (!active || !escapeToStop) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || event.isComposing) return;
      event.preventDefault();
      onInterruptRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, escapeToStop]);

  if (!active && queue.length === 0) return null;

  return (
    <div
      data-status={status}
      className={cx('overflow-hidden rounded-hk border border-hk-border bg-hk-surface text-sm text-hk-fg', className)}
    >
      {active && (
        <div className="flex items-center gap-2 px-3 py-2">
          {status === 'waiting' ? (
            <UserRound aria-hidden className="size-4 shrink-0 text-hk-warning" />
          ) : (
            <LoaderCircle aria-hidden className="size-4 shrink-0 text-hk-accent motion-safe:animate-spin" />
          )}
          <span role="status" className={cx('text-sm', status === 'waiting' && 'text-hk-warning')}>
            {status === 'waiting' ? labels.waiting : labels.running}
          </span>
          {elapsed !== undefined && (
            <span className="text-xs tabular-nums text-hk-muted">{formatDuration(Math.floor(elapsed / 1000) * 1000)}</span>
          )}
          <Button
            variant="secondary"
            className="ml-auto"
            shortcut={escapeToStop ? 'Esc' : undefined}
            onClick={onInterrupt}
          >
            <Square aria-hidden className="size-3 fill-current" />
            {labels.stop}
          </Button>
        </div>
      )}

      {queue.length > 0 && (
        <ul aria-label={labels.queued} className={cx('px-3 py-1.5', active && 'border-t border-hk-border')}>
          {queue.map((q) => (
            <li key={q.id} className="flex min-w-0 items-center gap-2 py-1">
              <CornerDownRight aria-hidden className="size-3.5 shrink-0 text-hk-muted" />
              <span className="shrink-0 text-xs text-hk-muted">{labels.queued}</span>
              <span className="min-w-0 flex-1 truncate" title={q.text}>
                {q.text}
              </span>
              {onRemoveQueued && (
                <button
                  type="button"
                  aria-label={`${labels.removeQueued}: ${q.text}`}
                  onClick={() => onRemoveQueued(q.id)}
                  className="rounded p-0.5 text-hk-muted hover:bg-hk-subtle hover:text-hk-fg focus-visible:outline-2 focus-visible:outline-hk-accent"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              )}
            </li>
          ))}
          {active && <li className="pb-0.5 text-[11px] text-hk-muted">{labels.queueHint}</li>}
        </ul>
      )}
    </div>
  );
}

function useElapsed(since: number | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  return since === undefined ? undefined : Math.max(0, now - since);
}
