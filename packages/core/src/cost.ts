import type { TokenUsage, TranscriptState } from './protocol';
import { usageTotals } from './selectors';

/**
 * USD per million tokens. harnesskit ships no price table on purpose:
 * prices change and differ by platform, so pass your own (e.g. from your
 * billing config or the provider's pricing page).
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export type PriceTable = Record<string, ModelPrice>;

export interface CostLine {
  model: string;
  tokens: TokenUsage;
  usd: number;
  /** False when a price needed for these tokens is missing; `usd` then leaves those tokens out. */
  priced: boolean;
}

export interface CostEstimate {
  usd: number;
  tokens: TokenUsage;
  lines: CostLine[];
  /** False when any line is missing a price; show the total as a lower bound. */
  complete: boolean;
}

const PER_TOKEN = 1 / 1_000_000;

/**
 * Estimates spend from the transcript's reported usage. Tokens without a
 * known price are never guessed at: they are left out and the estimate is
 * marked incomplete.
 *
 * Limitation: with server-side fallbacks, providers may bill each attempt
 * separately (Anthropic's `usage.iterations`); this uses the top-level
 * usage the stream reports for each message.
 */
export function estimateCost(state: TranscriptState, prices: PriceTable): CostEstimate {
  const { total, byModel } = usageTotals(state);
  const lines: CostLine[] = Object.entries(byModel).map(([model, tokens]) => {
    const price = prices[model];
    if (!price) return { model, tokens, usd: 0, priced: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite === 0 };
    let usd = (tokens.input * price.input + tokens.output * price.output) * PER_TOKEN;
    let priced = true;
    for (const [count, rate] of [
      [tokens.cacheRead, price.cacheRead],
      [tokens.cacheWrite, price.cacheWrite],
    ] as const) {
      if (count === 0) continue;
      if (rate === undefined) priced = false;
      else usd += count * rate * PER_TOKEN;
    }
    return { model, tokens, usd, priced };
  });
  lines.sort((a, b) => b.usd - a.usd);
  return { usd: lines.reduce((s, l) => s + l.usd, 0), tokens: total, lines, complete: lines.every((l) => l.priced) };
}
