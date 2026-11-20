export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function formatDuration(ms: number): string {
  if (ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** 950 → "950", 12_345 → "12.3k", 200_000 → "200k", 1_234_567 → "1.23M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 100 ? Number(k.toFixed(1)) : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? Number(m.toFixed(2)) : Number(m.toFixed(1))}M`;
}

/** 0 → "$0.00", 0.004 → "<$0.01", 0.0423 → "$0.042", 12.5 → "$12.50". */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
