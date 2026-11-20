import {
  suggestAlwaysRule,
  type PermissionDecision,
  type PermissionScope,
  type RiskLevel,
  type ToolCallPart,
} from '@harnesskit/core';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { defaultToolSummary } from './ToolCallCard';
import { Button, canTakeFocus, isTypingTarget, RiskBadge } from './ui';
import { cx } from './utils';

export interface PermissionPromptLabels {
  title: string;
  counter: (index: number, total: number) => string;
  allow: string;
  allowAlways: string;
  deny: string;
  allowAll: (n: number) => string;
  rulePreview: string;
  highRiskHint: string;
  showInput: string;
  next: string;
  risk: Record<RiskLevel, string>;
}

export const defaultPermissionPromptLabels: PermissionPromptLabels = {
  title: 'Approval needed',
  counter: (i, n) => `${i} of ${n}`,
  allow: 'Allow',
  allowAlways: 'Always allow',
  deny: 'Deny',
  allowAll: (n) => `Allow all ${n}`,
  rulePreview: 'Always allow saves the rule',
  highRiskHint: 'High risk: keyboard shortcuts are off. Click to decide.',
  showInput: 'Full input',
  next: 'Up next',
  risk: { low: 'Low risk', medium: 'Medium risk', high: 'High risk' },
};

export interface PermissionPromptProps {
  /** Open requests, oldest first. Use `pendingPermissions(state)` from core. */
  requests: readonly ToolCallPart[];
  onResolve: (toolCallId: string, decision: PermissionDecision, scope: PermissionScope, rule?: string) => void;
  /**
   * The rule "Always allow" would store. Return `undefined` to hide the
   * option for that call. Defaults to `suggestAlwaysRule` from core.
   */
  suggestRule?: (part: ToolCallPart) => string | undefined;
  /** Offer "Always allow" on high-risk calls too. Off by default. */
  allowAlwaysForHighRisk?: boolean;
  /** One-line description of the call. Defaults to the most telling input field. */
  summarize?: (part: ToolCallPart) => ReactNode;
  /** Move focus to the prompt when a new request arrives, unless the user is typing elsewhere. */
  autoFocus?: boolean;
  labels?: Partial<PermissionPromptLabels>;
  className?: string;
}

/**
 * The approval surface for every pending tool call, one at a time.
 *
 * - Shortcuts while focused: `y` allow, `a` always allow, `n` deny. They are
 *   disabled for high-risk calls, which need a deliberate click.
 * - "Allow all" appears only when more than one request is waiting and none
 *   of them is high risk.
 * - "Always allow" previews the exact rule it will store.
 */
export function PermissionPrompt({
  requests,
  onResolve,
  suggestRule = suggestAlwaysRule,
  allowAlwaysForHighRisk = false,
  summarize = defaultToolSummary,
  autoFocus = true,
  labels: overrides,
  className,
}: PermissionPromptProps) {
  const labels = { ...defaultPermissionPromptLabels, ...overrides };
  const root = useRef<HTMLElement>(null);
  const current = requests[0];
  const currentId = current?.toolCallId;

  useEffect(() => {
    if (currentId && autoFocus && canTakeFocus()) root.current?.focus({ preventScroll: true });
  }, [currentId, autoFocus]);

  if (!current) return null;

  const risk = current.permission?.risk;
  const highRisk = risk === 'high';
  const rule = highRisk && !allowAlwaysForHighRisk ? undefined : suggestRule(current);
  const anyHighRisk = requests.some((r) => r.permission?.risk === 'high');
  const summary = summarize(current);

  const resolve = (decision: PermissionDecision, scope: PermissionScope = 'once') =>
    onResolve(current.toolCallId, decision, scope, scope === 'always' ? rule : undefined);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (highRisk || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event)) return;
    const key = event.key.toLowerCase();
    if (key === 'y') resolve('allow');
    else if (key === 'n') resolve('deny');
    else if (key === 'a' && rule) resolve('allow', 'always');
    else return;
    event.preventDefault();
  };

  return (
    <section
      ref={root}
      tabIndex={-1}
      aria-labelledby={`hk-perm-${current.toolCallId}`}
      onKeyDown={onKeyDown}
      data-risk={risk}
      className={cx(
        'overflow-hidden rounded-hk border bg-hk-surface text-sm text-hk-fg outline-none focus-visible:ring-2 focus-visible:ring-hk-accent/40',
        highRisk ? 'border-hk-danger/50' : 'border-hk-warning/60',
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-hk-border bg-hk-warning-subtle px-3 py-2">
        <ShieldAlert aria-hidden className="size-4 shrink-0 text-hk-warning" />
        <h3 id={`hk-perm-${current.toolCallId}`} className="text-sm font-semibold">
          {labels.title}
        </h3>
        {requests.length > 1 && (
          <span className="text-xs tabular-nums text-hk-muted">{labels.counter(1, requests.length)}</span>
        )}
        {requests.length > 1 && !anyHighRisk && (
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => requests.forEach((r) => onResolve(r.toolCallId, 'allow', 'once'))}
          >
            {labels.allowAll(requests.length)}
          </Button>
        )}
      </header>

      <div className="space-y-2 px-3 py-3" aria-live="polite">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[13px] font-medium">{current.name}</span>
          {risk && <RiskBadge risk={risk}>{labels.risk[risk]}</RiskBadge>}
        </div>
        {current.permission?.reason && <p className="text-sm leading-relaxed">{current.permission.reason}</p>}
        {summary && (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-hk-subtle px-2.5 py-2 font-mono text-xs">
            {summary}
          </pre>
        )}
        <details className="text-xs text-hk-muted">
          <summary className="cursor-pointer select-none hover:text-hk-fg">{labels.showInput}</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-hk-subtle px-2.5 py-2 font-mono text-hk-fg">
            {JSON.stringify(current.input, null, 2)}
          </pre>
        </details>
        {rule && (
          <p className="text-xs text-hk-muted">
            {labels.rulePreview}{' '}
            <code className="rounded bg-hk-subtle px-1 py-px font-mono text-hk-fg">{rule}</code>
          </p>
        )}
        {highRisk && <p className="text-xs text-hk-danger">{labels.highRiskHint}</p>}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-1.5 border-t border-hk-border px-3 py-2">
        <Button variant="ghost" shortcut={highRisk ? undefined : 'N'} onClick={() => resolve('deny')}>
          {labels.deny}
        </Button>
        {rule && (
          <Button variant="secondary" shortcut={highRisk ? undefined : 'A'} onClick={() => resolve('allow', 'always')}>
            {labels.allowAlways}
          </Button>
        )}
        <Button variant="primary" shortcut={highRisk ? undefined : 'Y'} onClick={() => resolve('allow')}>
          {labels.allow}
        </Button>
      </footer>

      {requests.length > 1 && (
        <ol className="border-t border-hk-border bg-hk-subtle/60 px-3 py-2 text-xs text-hk-muted" aria-label={labels.next}>
          {requests.slice(1, 4).map((r) => (
            <li key={r.toolCallId} className="flex min-w-0 items-center gap-2 py-0.5">
              <span className="shrink-0 font-mono">{r.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono">{summarize(r)}</span>
              {r.permission?.risk === 'high' && (
                <span className="shrink-0 text-hk-danger">{labels.risk.high}</span>
              )}
            </li>
          ))}
          {requests.length > 4 && <li className="py-0.5">+{requests.length - 4}</li>}
        </ol>
      )}
    </section>
  );
}
