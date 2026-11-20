// @vitest-environment jsdom
import { estimateCost, replay, type HarnessError, type HarnessEvent } from '@harnesskit/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMeter } from './ContextMeter';
import { CostTicker } from './CostTicker';
import { ErrorBanner } from './ErrorBanner';
import { FallbackNotice } from './FallbackNotice';
import { formatTokens, formatUsd } from './utils';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('formatters', () => {
  it.each([
    [950, '950'],
    [12_345, '12.3k'],
    [200_000, '200k'],
    [1_000_000, '1M'],
    [1_234_567, '1.23M'],
  ])('formatTokens(%i) = %s', (n, s) => expect(formatTokens(n)).toBe(s));

  it.each([
    [0, '$0.00'],
    [0.004, '<$0.01'],
    [0.0423, '$0.042'],
    [12.5, '$12.50'],
  ])('formatUsd(%d) = %s', (n, s) => expect(formatUsd(n)).toBe(s));
});

describe('ContextMeter', () => {
  it.each([
    [undefined, 'none', '–'],
    [50_000, 'ok', '25%'],
    [170_000, 'warn', '85%'],
    [195_000, 'danger', '98%'],
  ])('used=%s is %s', (used, level, text) => {
    render(<ContextMeter used={used} limit={200_000} />);
    const meter = screen.getByRole('meter', { name: 'Context' });
    expect(meter.dataset.level).toBe(level);
    expect(meter.textContent).toContain(text);
    if (level === 'danger') expect(meter.textContent).toContain('Context almost full');
  });

  it('says full, not almost full, once the window is exceeded', () => {
    render(<ContextMeter used={210_000} limit={200_000} />);
    expect(screen.getByRole('meter').textContent).toBe('100%Context full');
  });

  it('describes itself for screen readers', () => {
    render(<ContextMeter used={124_000} limit={200_000} />);
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toBe('62%, 124k / 200k tokens');
  });
});

describe('CostTicker', () => {
  const usage = (input: number, model = 'opus'): HarnessEvent[] => [
    { type: 'message.start', messageId: `m${input}`, role: 'assistant', model },
    { type: 'usage', messageId: `m${input}`, usage: { input } },
  ];
  const prices = { opus: { input: 4, output: 20 } };

  it('shows the total, the budget, and a lower bound when prices are missing', () => {
    const est = estimateCost(replay([...usage(100_000), ...usage(5, 'mystery')]), prices);
    render(<CostTicker estimate={est} budget={1} />);
    expect(screen.getByText('≥$0.400')).toBeTruthy();
    expect(screen.getByText('/ $1.00')).toBeTruthy();
    expect(screen.getByText('No price set')).toBeTruthy();
  });

  it('turns to warning near the budget', () => {
    const { container } = render(<CostTicker estimate={estimateCost(replay(usage(220_000)), prices)} budget={1} />);
    const total = container.querySelector('summary > span')!;
    expect(total.textContent).toBe('$0.880');
    expect(total.className).toContain('text-hk-warning');
  });

  it('throttles visible updates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { container, rerender } = render(
      <CostTicker estimate={estimateCost(replay(usage(100_000)), prices)} throttleMs={500} />,
    );
    const shown = () => container.querySelector('summary > span')!.textContent;
    expect(shown()).toBe('$0.400');
    rerender(<CostTicker estimate={estimateCost(replay(usage(150_000)), prices)} throttleMs={500} />);
    expect(shown()).toBe('$0.400');
    act(() => vi.advanceTimersByTime(500));
    expect(shown()).toBe('$0.600');
  });
});

describe('ErrorBanner', () => {
  const error = (extra: Partial<HarnessError> = {}): HarnessError => ({
    id: 'e1',
    kind: 'rate_limit',
    message: 'Too many requests',
    status: 'active',
    retryable: true,
    attempt: 1,
    maxAttempts: 5,
    httpStatus: 429,
    ...extra,
  });

  it('renders nothing without an open error', () => {
    const { container, rerender } = render(<ErrorBanner error={undefined} />);
    expect(container.innerHTML).toBe('');
    rerender(<ErrorBanner error={error({ status: 'resolved' })} />);
    expect(container.innerHTML).toBe('');
  });

  it('counts down to a scheduled retry and offers to retry now', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onRetry = vi.fn();
    render(<ErrorBanner error={error({ retryAt: 12_000 })} onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('Retrying in 12s');
    expect(screen.getByText('Attempt 1 of 5')).toBeTruthy();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole('alert').textContent).toContain('Retrying in 7s');
    vi.useRealTimers();
    await userEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(onRetry).toHaveBeenCalledWith('e1');
  });

  it('shows progress while retrying and hides the retry button', () => {
    render(<ErrorBanner error={error({ status: 'retrying', attempt: 2 })} onRetry={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain('Retrying…');
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('uses the danger tone and no retry for refusals', () => {
    render(
      <ErrorBanner
        error={error({ kind: 'refusal', retryable: false, httpStatus: undefined, category: 'cyber', message: 'Declined.' })}
        onRetry={() => {}}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('bg-hk-danger-subtle');
    expect(alert.textContent).toContain('The model declined');
    expect(alert.textContent).toContain('(cyber)');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('FallbackNotice', () => {
  it('names both models with display names', () => {
    const names: Record<string, string> = { 'claude-opus-5-5': 'Opus 5.5', 'claude-opus-4-8': 'Opus 4.8' };
    render(
      <FallbackNotice
        part={{ kind: 'fallback', id: 'f', from: 'claude-opus-5-5', to: 'claude-opus-4-8' }}
        formatModel={(m) => names[m] ?? m}
      />,
    );
    expect(screen.getByRole('note').textContent).toBe('Continued with Opus 4.8·Opus 5.5 declined this request');
  });
});
