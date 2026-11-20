import type { FallbackPart } from '@harnesskit/core';
import { ArrowRightLeft } from 'lucide-react';
import { cx } from './utils';

export interface FallbackNoticeLabels {
  /** Main line, e.g. "Continued with Opus 4.8". */
  continuedWith: (to: string) => string;
  /** Secondary line, e.g. "Opus 5.5 declined this request". */
  declined: (from: string) => string;
}

export const defaultFallbackNoticeLabels: FallbackNoticeLabels = {
  continuedWith: (to) => `Continued with ${to}`,
  declined: (from) => `${from} declined this request`,
};

export interface FallbackNoticeProps {
  part: FallbackPart;
  /** Display names for model ids, e.g. `claude-opus-5-5` → `Opus 5.5`. */
  formatModel?: (model: string) => string;
  labels?: Partial<FallbackNoticeLabels>;
  className?: string;
}

/**
 * Marks the point in a message where another model took over. Everything
 * above the line was written by `from`, everything below by `to`.
 */
export function FallbackNotice({ part, formatModel = (m) => m, labels: overrides, className }: FallbackNoticeProps) {
  const labels = { ...defaultFallbackNoticeLabels, ...overrides };
  const from = formatModel(part.from);
  const to = formatModel(part.to);
  return (
    <div role="note" className={cx('flex items-center gap-2 py-1 text-xs text-hk-muted', className)}>
      <span aria-hidden className="h-px flex-1 bg-hk-border" />
      <ArrowRightLeft aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 text-center">
        <span className="font-medium text-hk-fg">{labels.continuedWith(to)}</span>
        <span className="mx-1.5" aria-hidden>
          ·
        </span>
        <span>{labels.declined(from)}</span>
      </span>
      <span aria-hidden className="h-px flex-1 bg-hk-border" />
    </div>
  );
}
