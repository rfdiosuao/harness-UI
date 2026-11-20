import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createAnthropicAdapter } from './adapters/anthropic';
import { estimateCost } from './cost';
import { errorEventFrom } from './errors';
import type { FallbackPart, HarnessEvent } from './protocol';
import { replay } from './reducer';
import { activeError, contextTokens, usageTotals } from './selectors';

const raw = (e: object) => e as Anthropic.RawMessageStreamEvent;

describe('usage', () => {
  it('replaces reported fields and keeps the rest', () => {
    const state = replay([
      { type: 'message.start', messageId: 'm1', role: 'assistant', model: 'opus' },
      { type: 'usage', messageId: 'm1', usage: { input: 1000, output: 1, cacheRead: 5000 } },
      { type: 'usage', messageId: 'm1', usage: { output: 420 } },
      { type: 'usage', messageId: 'm1', usage: { input: -5, cacheWrite: Number.NaN } },
    ]);
    expect(state.usage.m1).toEqual({ model: 'opus', tokens: { input: 1000, output: 420, cacheRead: 5000, cacheWrite: 0 } });
  });

  it('totals per model and estimates the context from the latest assistant message', () => {
    const state = replay([
      { type: 'message.start', messageId: 'a', role: 'assistant', model: 'opus' },
      { type: 'usage', messageId: 'a', usage: { input: 100, output: 50 } },
      { type: 'message.start', messageId: 'u', role: 'user' },
      { type: 'message.start', messageId: 'b', role: 'assistant', model: 'haiku' },
      { type: 'usage', messageId: 'b', usage: { input: 200, cacheRead: 1000, output: 30 } },
    ]);
    expect(usageTotals(state)).toEqual({
      total: { input: 300, output: 80, cacheRead: 1000, cacheWrite: 0 },
      byModel: {
        opus: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        haiku: { input: 200, output: 30, cacheRead: 1000, cacheWrite: 0 },
      },
    });
    expect(contextTokens(state)).toBe(1230);
    expect(contextTokens(replay([]))).toBeUndefined();
  });
});

describe('estimateCost', () => {
  const state = replay([
    { type: 'message.start', messageId: 'a', role: 'assistant', model: 'opus' },
    { type: 'usage', messageId: 'a', usage: { input: 1_000_000, output: 100_000, cacheRead: 2_000_000 } },
    { type: 'message.start', messageId: 'b', role: 'assistant', model: 'mystery' },
    { type: 'usage', messageId: 'b', usage: { input: 10 } },
  ]);

  it('prices known models and refuses to guess the rest', () => {
    const est = estimateCost(state, { opus: { input: 4, output: 20, cacheRead: 0.2 } });
    expect(est.usd).toBeCloseTo(4 + 2 + 0.4, 10);
    expect(est.complete).toBe(false);
    expect(est.lines.map((l) => [l.model, l.priced])).toEqual([
      ['opus', true],
      ['mystery', false],
    ]);
  });

  it('marks tokens with a missing cache price as unpriced, never guessed', () => {
    const est = estimateCost(state, { opus: { input: 4, output: 20 }, mystery: { input: 1, output: 1 } });
    expect(est.usd).toBeCloseTo(6 + 0.00001, 10);
    expect(est.lines.find((l) => l.model === 'opus')!.priced).toBe(false);
    expect(est.complete).toBe(false);
  });
});

describe('model.fallback', () => {
  it('adds a switch-point part and updates the message model', () => {
    const state = replay([
      { type: 'message.start', messageId: 'm', role: 'assistant', model: 'big' },
      { type: 'model.fallback', messageId: 'm', partId: 'f', from: 'big', to: 'small' },
      { type: 'usage', messageId: 'm', usage: { output: 5 } },
    ]);
    expect(state.messages[0]!.model).toBe('small');
    expect(state.messages[0]!.parts[0]).toMatchObject({ kind: 'fallback', from: 'big', to: 'small' });
    expect(state.usage.m!.model).toBe('small');
  });
});

describe('errors', () => {
  const report = (extra: Partial<Extract<HarnessEvent, { type: 'error' }>> = {}): HarnessEvent => ({
    type: 'error',
    errorId: 'e1',
    kind: 'rate_limit',
    message: 'Too many requests',
    retryable: true,
    retryAt: 5000,
    attempt: 1,
    maxAttempts: 3,
    at: 1000,
    ...extra,
  });

  it('upserts by id and walks through retry and resolve', () => {
    let state = replay([report()]);
    expect(activeError(state)).toMatchObject({ status: 'active', retryAt: 5000, attempt: 1 });

    state = replay([{ type: 'error.retry', errorId: 'e1' }], state);
    expect(activeError(state)).toMatchObject({ status: 'retrying', retryAt: undefined, attempt: 2 });

    state = replay([report({ attempt: 2, retryAt: 9000, at: 6000 })], state);
    expect(state.errors).toHaveLength(1);
    expect(activeError(state)).toMatchObject({ status: 'active', attempt: 2, retryAt: 9000, at: 1000 });

    state = replay([{ type: 'error.resolve', errorId: 'e1', outcome: 'recovered' }], state);
    expect(activeError(state)).toBeUndefined();
    expect(state.errors[0]!.status).toBe('resolved');

    state = replay([{ type: 'error.retry', errorId: 'e1' }], state);
    expect(state.warnings).toEqual(['Error e1 is already resolved']);
  });

  it('shows the newest error still open', () => {
    const state = replay([
      report(),
      report({ errorId: 'e2', kind: 'network', message: 'offline' }),
      { type: 'error.resolve', errorId: 'e2', outcome: 'dismissed' },
    ]);
    expect(activeError(state)?.id).toBe('e1');
  });
});

describe('errorEventFrom', () => {
  const now = () => 10_000;
  const err = (status: number | undefined, headers?: unknown, message = 'boom') =>
    Object.assign(new Error(message), status === undefined ? {} : { status, headers });

  it('reads retry-after seconds from a Headers object', () => {
    const e = errorEventFrom(err(429, new Headers({ 'retry-after': '7' })), { errorId: 'x', now });
    expect(e).toMatchObject({ kind: 'rate_limit', retryable: true, retryAt: 17_000, httpStatus: 429, attempt: 1 });
  });

  it('reads retry-after as an HTTP date from a plain record', () => {
    const date = new Date(40_000).toUTCString();
    expect(errorEventFrom(err(529, { 'retry-after': date }), { errorId: 'x', now }).retryAt).toBe(40_000);
  });

  it('falls back to exponential backoff', () => {
    expect(errorEventFrom(err(500), { errorId: 'x', now, attempt: 3 }).retryAt).toBe(10_000 + 8000);
  });

  it.each([
    [401, 'auth', false],
    [403, 'auth', false],
    [400, 'invalid_request', false],
    [413, 'invalid_request', false],
    [408, 'server', true],
    [503, 'server', true],
  ])('classifies %i as %s', (status, kind, retryable) => {
    expect(errorEventFrom(err(status), { errorId: 'x', now })).toMatchObject({ kind, retryable });
  });

  it('recognizes network failures without a status', () => {
    expect(errorEventFrom(new TypeError('fetch failed'), { errorId: 'x', now })).toMatchObject({ kind: 'network', retryable: true });
    expect(errorEventFrom('weird', { errorId: 'x', now })).toMatchObject({ kind: 'unknown', retryable: false, message: 'weird' });
  });

  it('stops scheduling retries on the last attempt', () => {
    const e = errorEventFrom(err(429), { errorId: 'x', now, attempt: 3, maxAttempts: 3 });
    expect(e).toMatchObject({ retryable: false, retryAt: undefined });
  });
});

describe('Anthropic adapter: usage, fallback, refusal', () => {
  it('maps usage, the fallback switch point, and a refusal', () => {
    const translate = createAnthropicAdapter({ now: () => 1 });
    const events = [
      raw({
        type: 'message_start',
        message: {
          id: 'msg',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [],
          usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0 },
        },
      }),
      raw({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Part one. ' } }),
      raw({ type: 'content_block_stop', index: 0 }),
      raw({ type: 'content_block_start', index: 1, content_block: { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } } }),
      raw({ type: 'content_block_stop', index: 1 }),
      raw({ type: 'content_block_start', index: 2, content_block: { type: 'text', text: 'Part two.' } }),
      raw({ type: 'content_block_stop', index: 2 }),
      raw({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 300, input_tokens: null } }),
      raw({ type: 'message_stop' }),
    ].flatMap(translate);
    const state = replay(events);
    expect(state.warnings).toEqual([]);
    expect(state.messages[0]).toMatchObject({ model: 'claude-opus-4-8' });
    expect((state.messages[0]!.parts[1] as FallbackPart)).toMatchObject({ kind: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-4-8' });
    expect(state.usage.msg).toEqual({
      model: 'claude-opus-4-8',
      tokens: { input: 1200, output: 300, cacheRead: 8000, cacheWrite: 0 },
    });
  });

  it('reports a refusal stop reason as an error with its details', () => {
    const translate = createAnthropicAdapter({ now: () => 1 });
    const state = replay(
      [
        raw({ type: 'message_start', message: { id: 'msg', role: 'assistant', model: 'm', content: [] } }),
        raw({
          type: 'message_delta',
          delta: { stop_reason: 'refusal', stop_sequence: null, stop_details: { type: 'refusal', category: 'cyber', explanation: 'Declined.' } },
          usage: { output_tokens: 0 },
        }),
        raw({ type: 'message_stop' }),
      ].flatMap(translate),
    );
    expect(activeError(state)).toMatchObject({ id: 'msg:refusal', kind: 'refusal', category: 'cyber', message: 'Declined.', retryable: false });
    expect(state.messages[0]!.stopReason).toBe('refusal');
  });
});
