import type { CostEstimate } from '@harnesskit/core';
import { useEffect, useRef, useState } from 'react';
import { cx, formatTokens, formatUsd } from './utils';

export interface CostTickerLabels {
  label: string;
  model: string;
  tokens: string;
  cost: string;
  noPrice: string;
  incomplete: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
}

export const defaultCostTickerLabels: CostTickerLabels = {
  label: 'Cost',
  model: 'Model',
  tokens: 'Tokens',
  cost: 'Cost',
  noPrice: 'No price set',
  incomplete: 'Some tokens have no price, so this is a lower bound.',
  input: 'in',
  output: 'out',
  cacheRead: 'cache read',
  cacheWrite: 'cache write',
};

export interface CostTickerProps {
  /** `estimateCost(state, prices)` from core. */
  estimate: CostEstimate;
  /** Spend limit in USD; the ticker turns to warning at 80% and danger at 100%. */
  budget?: number;
  /** Display names for model ids. */
  formatModel?: (model: string) => string;
  /** Minimum ms between visible updates, so the number doesn't flicker while streaming. */
  throttleMs?: number;
  labels?: Partial<CostTickerLabels>;
  className?: string;
}

function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      setShown(value);
      return;
    }
    const id = window.setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return shown;
}

/** Running spend for the session, with a per-model breakdown on click. */
export function CostTicker({
  estimate: live,
  budget,
  formatModel = (m) => m,
  throttleMs = 500,
  labels: overrides,
  className,
}: CostTickerProps) {
  const labels = { ...defaultCostTickerLabels, ...overrides };
  const estimate = useThrottled(live, throttleMs);
  const ratio = budget ? estimate.usd / budget : 0;
  const tone = ratio >= 1 ? 'text-hk-danger' : ratio >= 0.8 ? 'text-hk-warning' : 'text-hk-fg';
  const total = `${estimate.complete ? '' : '≥'}${formatUsd(estimate.usd)}`;

  return (
    <details className={cx('group relative text-xs', className)}>
      <summary
        aria-label={`${labels.label}: ${total}${budget !== undefined ? ` of ${formatUsd(budget)}` : ''}`}
        className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 text-hk-muted select-none hover:bg-hk-subtle [&::-webkit-details-marker]:hidden"
      >
        <span className={cx('font-medium tabular-nums', tone)}>{total}</span>
        {budget !== undefined && <span className="tabular-nums">/ {formatUsd(budget)}</span>}
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-max max-w-[min(28rem,calc(100vw-3rem))] overflow-x-auto rounded-hk border border-hk-border bg-hk-surface p-2 shadow-lg">
        <table className="text-xs">
          <thead className="text-hk-muted">
            <tr>
              <th className="px-2 py-1 text-left font-medium">{labels.model}</th>
              <th className="px-2 py-1 text-left font-medium">{labels.tokens}</th>
              <th className="px-2 py-1 text-right font-medium">{labels.cost}</th>
            </tr>
          </thead>
          <tbody>
            {estimate.lines.map((line) => (
              <tr key={line.model} className="border-t border-hk-border align-top">
                <td className="px-2 py-1 font-mono">{formatModel(line.model)}</td>
                <td className="px-2 py-1 text-hk-muted tabular-nums">
                  {formatTokens(line.tokens.input)} {labels.input} · {formatTokens(line.tokens.output)} {labels.output}
                  {line.tokens.cacheRead > 0 && ` · ${formatTokens(line.tokens.cacheRead)} ${labels.cacheRead}`}
                  {line.tokens.cacheWrite > 0 && ` · ${formatTokens(line.tokens.cacheWrite)} ${labels.cacheWrite}`}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {line.priced ? formatUsd(line.usd) : <span className="text-hk-warning">{labels.noPrice}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!estimate.complete && <p className="mt-1 max-w-64 px-2 text-[11px] text-hk-warning">{labels.incomplete}</p>}
      </div>
    </details>
  );
}
