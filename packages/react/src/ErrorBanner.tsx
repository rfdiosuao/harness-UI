import type { ErrorKind, HarnessError } from '@harnesskit/core';
import { CircleAlert, LoaderCircle, OctagonX, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './ui';
import { cx } from './utils';

export interface ErrorBannerLabels {
  title: Record<ErrorKind, string>;
  retryIn: (seconds: number) => string;
  retrying: string;
  attempt: (n: number, max?: number) => string;
  retryNow: string;
  retry: string;
  dismiss: string;
}

export const defaultErrorBannerLabels: ErrorBannerLabels = {
  title: {
    rate_limit: 'Rate limited',
    overloaded: 'The API is overloaded',
    server: 'Server error',
    network: 'Connection lost',
    auth: 'Authentication failed',
    invalid_request: 'Request rejected',
    refusal: 'The model declined',
    unknown: 'Something went wrong',
  },
  retryIn: (s) => `Retrying in ${s}s`,
  retrying: 'Retrying…',
  attempt: (n, max) => (max ? `Attempt ${n} of ${max}` : `Attempt ${n}`),
  retryNow: 'Retry now',
  retry: 'Retry',
  dismiss: 'Dismiss',
};

export interface ErrorBannerProps {
  /** `activeError(state)` from core. Renders nothing when undefined. */
  error: HarnessError | undefined;
  /** Shown for retryable errors. Your harness runs the retry and emits `error.retry`. */
  onRetry?: (errorId: string) => void;
  onDismiss?: (errorId: string) => void;
  labels?: Partial<Omit<ErrorBannerLabels, 'title'>> & { title?: Partial<ErrorBannerLabels['title']> };
  className?: string;
}

/** Transient problems the harness may recover from, as opposed to the user's mistake. */
const TRANSIENT: ReadonlySet<ErrorKind> = new Set(['rate_limit', 'overloaded', 'server', 'network']);

function useSecondsUntil(at: number | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === undefined) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [at]);
  return at === undefined ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * The current error, what the harness is doing about it, and what the user
 * can do. Transient errors (rate limits, overload, network) use the warning
 * tone and show the retry countdown; the rest use the danger tone.
 */
export function ErrorBanner({ error, onRetry, onDismiss, labels: overrides, className }: ErrorBannerProps) {
  const labels: ErrorBannerLabels = {
    ...defaultErrorBannerLabels,
    ...overrides,
    title: { ...defaultErrorBannerLabels.title, ...overrides?.title },
  };
  const seconds = useSecondsUntil(error?.status === 'active' ? error.retryAt : undefined);
  if (!error || (error.status !== 'active' && error.status !== 'retrying')) return null;

  const transient = TRANSIENT.has(error.kind);
  const Icon = error.kind === 'network' ? WifiOff : transient ? CircleAlert : OctagonX;
  const retrying = error.status === 'retrying';
  const scheduled = seconds !== undefined;

  return (
    <div
      role="alert"
      data-kind={error.kind}
      data-status={error.status}
      className={cx(
        'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-hk border px-3 py-2 text-sm',
        transient ? 'border-hk-warning/50 bg-hk-warning-subtle' : 'border-hk-danger/40 bg-hk-danger-subtle',
        className,
      )}
    >
      <Icon aria-hidden className={cx('mt-0.5 size-4 shrink-0', transient ? 'text-hk-warning' : 'text-hk-danger')} />
      <div className="min-w-0 flex-1 basis-48">
        <p className="font-medium">
          {labels.title[error.kind]}
          {error.httpStatus !== undefined && <span className="ml-1.5 font-mono text-xs text-hk-muted">{error.httpStatus}</span>}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed break-words text-hk-fg/80">
          {error.message}
          {error.category && <span className="ml-1 font-mono text-hk-muted">({error.category})</span>}
        </p>
        {(retrying || scheduled || error.attempt !== undefined) && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-hk-muted">
            {retrying && <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" />}
            <span className="tabular-nums">
              {retrying ? labels.retrying : scheduled ? labels.retryIn(seconds) : null}
            </span>
            {error.attempt !== undefined && (retrying || scheduled) && <span aria-hidden>·</span>}
            {error.attempt !== undefined && <span>{labels.attempt(error.attempt, error.maxAttempts)}</span>}
          </p>
        )}
      </div>
      <div className="ml-auto flex shrink-0 gap-1.5">
        {onDismiss && (
          <Button variant="ghost" onClick={() => onDismiss(error.id)}>
            {labels.dismiss}
          </Button>
        )}
        {onRetry && error.retryable && !retrying && (
          <Button variant="secondary" onClick={() => onRetry(error.id)}>
            {scheduled ? labels.retryNow : labels.retry}
          </Button>
        )}
      </div>
    </div>
  );
}
