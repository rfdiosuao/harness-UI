import { cx, formatTokens } from './utils';

export interface ContextMeterLabels {
  label: string;
  almostFull: string;
  full: string;
  unknown: string;
}

export const defaultContextMeterLabels: ContextMeterLabels = {
  label: 'Context',
  almostFull: 'Context almost full',
  full: 'Context full',
  unknown: 'No usage yet',
};

export interface ContextMeterProps {
  /** Tokens in context; `contextTokens(state)` from core. */
  used: number | undefined;
  /** The model's context window, e.g. from the provider's models API. */
  limit: number;
  /** Fraction at which the meter turns to the warning color. */
  warnAt?: number;
  /** Fraction at which it turns to the danger color and says so. */
  dangerAt?: number;
  labels?: Partial<ContextMeterLabels>;
  className?: string;
}

const R = 6;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** A small ring showing how full the context window is. */
export function ContextMeter({
  used,
  limit,
  warnAt = 0.8,
  dangerAt = 0.95,
  labels: overrides,
  className,
}: ContextMeterProps) {
  const labels = { ...defaultContextMeterLabels, ...overrides };
  const known = used !== undefined && limit > 0;
  const ratio = known ? Math.min(1, Math.max(0, used / limit)) : 0;
  const pct = Math.round(ratio * 100);
  const level = !known ? 'none' : ratio >= dangerAt ? 'danger' : ratio >= warnAt ? 'warn' : 'ok';
  const tone = { none: 'text-hk-muted', ok: 'text-hk-accent', warn: 'text-hk-warning', danger: 'text-hk-danger' }[level];
  const detail = known ? `${formatTokens(used)} / ${formatTokens(limit)} tokens` : labels.unknown;

  return (
    <div
      role="meter"
      aria-label={labels.label}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={known ? Math.min(used, limit) : undefined}
      aria-valuetext={known ? `${pct}%, ${detail}` : labels.unknown}
      title={`${labels.label}: ${detail}`}
      data-level={level}
      className={cx('inline-flex items-center gap-1.5 text-xs text-hk-muted', className)}
    >
      <svg viewBox="0 0 16 16" className="size-4 shrink-0 -rotate-90" aria-hidden>
        <circle cx="8" cy="8" r={R} fill="none" strokeWidth="2.5" className="stroke-hk-border" />
        <circle
          cx="8"
          cy="8"
          r={R}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          className={cx('stroke-current transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none', tone)}
        />
      </svg>
      <span className={cx('tabular-nums', level === 'danger' && 'text-hk-danger')}>{known ? `${pct}%` : '–'}</span>
      {level === 'danger' && <span className="text-hk-danger">{ratio >= 1 ? labels.full : labels.almostFull}</span>}
    </div>
  );
}
