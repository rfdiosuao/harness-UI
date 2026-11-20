import type { ErrorKind, HarnessEvent } from './protocol';

export interface ErrorEventOptions {
  errorId: string;
  attempt?: number;
  maxAttempts?: number;
  messageId?: string;
  /** Clock for `retryAt`; override in tests. */
  now?: () => number;
  /** Used when the error says it's retryable but gives no retry-after. Default 2 s × 2^(attempt-1). */
  backoffMs?: (attempt: number) => number;
}

function header(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const h = headers as { get?: (n: string) => string | null } & Record<string, unknown>;
  if (typeof h.get === 'function') return h.get(name) ?? undefined;
  const v = h[name] ?? h[name.toLowerCase()];
  return typeof v === 'string' ? v : undefined;
}

/** `retry-after` is either seconds or an HTTP date. */
function parseRetryAfter(value: string | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(now, date);
}

function classify(status: number | undefined, err: unknown): { kind: ErrorKind; retryable: boolean } {
  if (status === undefined) {
    const name = err instanceof Error ? `${err.name} ${err.message}` : String(err);
    return /connection|network|fetch failed|timeout|ECONN|ENOTFOUND|socket/i.test(name)
      ? { kind: 'network', retryable: true }
      : { kind: 'unknown', retryable: false };
  }
  if (status === 429) return { kind: 'rate_limit', retryable: true };
  if (status === 529) return { kind: 'overloaded', retryable: true };
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false };
  if (status === 408 || status === 409 || status >= 500) return { kind: 'server', retryable: true };
  return { kind: 'invalid_request', retryable: false };
}

/**
 * Turns a thrown provider error into an `error` event, without importing
 * any SDK: it reads `status`, `headers` and `message` structurally, so it
 * works with the Anthropic and OpenAI SDKs and plain fetch errors.
 */
export function errorEventFrom(err: unknown, options: ErrorEventOptions): Extract<HarnessEvent, { type: 'error' }> {
  const now = (options.now ?? Date.now)();
  const e = (err && typeof err === 'object' ? err : {}) as { status?: unknown; headers?: unknown; message?: unknown };
  const status = typeof e.status === 'number' ? e.status : undefined;
  const { kind, retryable } = classify(status, err);
  const attempt = options.attempt ?? 1;
  const outOfAttempts = options.maxAttempts !== undefined && attempt >= options.maxAttempts;
  const backoff = options.backoffMs ?? ((n: number) => 2000 * 2 ** (n - 1));
  const retryAt =
    retryable && !outOfAttempts ? (parseRetryAfter(header(e.headers, 'retry-after'), now) ?? now + backoff(attempt)) : undefined;

  return {
    type: 'error',
    errorId: options.errorId,
    kind,
    message: typeof e.message === 'string' && e.message ? e.message : String(err),
    retryable: retryable && !outOfAttempts,
    retryAt,
    attempt,
    maxAttempts: options.maxAttempts,
    httpStatus: status,
    messageId: options.messageId,
    at: now,
  };
}
