import * as Collapsible from '@radix-ui/react-collapsible';
import type {
  PermissionDecision,
  PermissionScope,
  RiskLevel,
  ToolCallPart,
  ToolStatus,
} from '@harnesskit/core';
import {
  Ban,
  Check,
  ChevronRight,
  CircleDashed,
  Clock,
  LoaderCircle,
  OctagonX,
  ShieldAlert,
  Square,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, RiskBadge } from './ui';
import { cx, formatDuration } from './utils';

export interface ToolCallCardLabels {
  status: Record<ToolStatus, string>;
  risk: Record<RiskLevel, string>;
  input: string;
  output: string;
  allow: string;
  allowAlways: string;
  deny: string;
}

export const defaultToolCallCardLabels: ToolCallCardLabels = {
  status: {
    'input-streaming': 'Preparing',
    pending: 'Queued',
    'awaiting-permission': 'Needs approval',
    running: 'Running',
    success: 'Done',
    error: 'Failed',
    denied: 'Denied',
    interrupted: 'Interrupted',
  },
  risk: { low: 'Low risk', medium: 'Medium risk', high: 'High risk' },
  input: 'Input',
  output: 'Output',
  allow: 'Allow',
  allowAlways: 'Always allow',
  deny: 'Deny',
};

export interface ToolCallCardProps {
  part: ToolCallPart;
  /** Called from the inline approval bar. Omit to render the request read-only. */
  onPermission?: (decision: PermissionDecision, scope: PermissionScope) => void;
  /** One-line summary next to the tool name. Defaults to the most telling input field. */
  summarize?: (part: ToolCallPart) => ReactNode;
  /** Custom renderers for the expanded sections. */
  renderInput?: (part: ToolCallPart) => ReactNode;
  renderOutput?: (part: ToolCallPart) => ReactNode;
  /** Start expanded. Cards needing attention (approval, failure) always start expanded. */
  defaultOpen?: boolean;
  labels?: Partial<Omit<ToolCallCardLabels, 'status' | 'risk'>> & {
    status?: Partial<ToolCallCardLabels['status']>;
    risk?: Partial<ToolCallCardLabels['risk']>;
  };
  className?: string;
}

const SUMMARY_KEYS = ['command', 'file_path', 'path', 'url', 'query', 'pattern', 'description'];

export function defaultToolSummary(part: ToolCallPart): string | undefined {
  const input = part.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    if (typeof record[key] === 'string') return record[key];
  }
  return Object.values(record).find((v): v is string => typeof v === 'string');
}

const STATUS_TONE: Record<ToolStatus, string> = {
  'input-streaming': 'text-hk-muted',
  pending: 'text-hk-muted',
  'awaiting-permission': 'text-hk-warning',
  running: 'text-hk-accent',
  success: 'text-hk-success',
  error: 'text-hk-danger',
  denied: 'text-hk-muted',
  interrupted: 'text-hk-muted',
};

function StatusIcon({ status }: { status: ToolStatus }) {
  const cls = cx('size-4 shrink-0', STATUS_TONE[status]);
  switch (status) {
    case 'input-streaming':
      return <CircleDashed className={cx(cls, 'motion-safe:animate-spin [animation-duration:3s]')} aria-hidden />;
    case 'pending':
      return <Clock className={cls} aria-hidden />;
    case 'awaiting-permission':
      return <ShieldAlert className={cls} aria-hidden />;
    case 'running':
      return <LoaderCircle className={cx(cls, 'motion-safe:animate-spin')} aria-hidden />;
    case 'success':
      return <Check className={cls} aria-hidden />;
    case 'error':
      return <OctagonX className={cls} aria-hidden />;
    case 'denied':
      return <Ban className={cls} aria-hidden />;
    case 'interrupted':
      return <Square className={cls} aria-hidden />;
  }
}

function stringify(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function Caret() {
  return (
    <span
      aria-hidden
      className="ml-px inline-block h-[1.1em] w-[0.5ch] translate-y-[0.15em] bg-current [animation:hk-caret_1s_steps(1)_infinite] motion-reduce:animate-none"
    />
  );
}

function Section({ label, tone, children }: { label: string; tone?: 'danger'; children: ReactNode }) {
  return (
    <div className="px-3 py-2">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-hk-muted">{label}</div>
      <pre
        className={cx(
          'max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md px-2.5 py-2 font-mono text-xs leading-relaxed',
          tone === 'danger' ? 'bg-hk-danger-subtle text-hk-danger' : 'bg-hk-subtle text-hk-fg',
        )}
      >
        {children}
      </pre>
    </div>
  );
}

/**
 * One tool call, from streaming input through approval to result.
 *
 * Styling hooks: the root carries `data-status` and `data-state` (open/closed).
 */
export function ToolCallCard({
  part,
  onPermission,
  summarize = defaultToolSummary,
  renderInput,
  renderOutput,
  defaultOpen = false,
  labels: labelOverrides,
  className,
}: ToolCallCardProps) {
  const labels: ToolCallCardLabels = {
    ...defaultToolCallCardLabels,
    ...labelOverrides,
    status: { ...defaultToolCallCardLabels.status, ...labelOverrides?.status },
    risk: { ...defaultToolCallCardLabels.risk, ...labelOverrides?.risk },
  };

  const needsAttention = part.status === 'awaiting-permission' || part.status === 'error';
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? (needsAttention || defaultOpen);

  const summary = summarize(part);
  // Execution time, not time spent waiting on the user. Calls that never ran
  // (denied) show no duration; calls with no explicit run event fall back to
  // the moment the model started emitting them.
  const timedFrom = part.runStartedAt ?? (part.status === 'denied' ? undefined : part.startedAt);
  const duration =
    timedFrom !== undefined && part.endedAt !== undefined ? formatDuration(part.endedAt - timedFrom) : undefined;

  const inputStreaming = part.status === 'input-streaming';
  const outputText = part.output || stringify(part.result);
  const showOutput = outputText !== '' || part.status === 'running';
  const risk = part.permission?.risk;

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setUserOpen}
      data-status={part.status}
      className={cx(
        'overflow-hidden rounded-hk border bg-hk-surface text-sm text-hk-fg transition-colors',
        part.status === 'awaiting-permission' ? 'border-hk-warning/60' : 'border-hk-border',
        className,
      )}
    >
      <Collapsible.Trigger className="group flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-hk-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-hk-accent">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-hk-muted transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
        />
        <StatusIcon status={part.status} />
        <span className="shrink-0 font-mono text-[13px] font-medium">{part.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-hk-muted">{summary}</span>
        {duration && <span className="shrink-0 text-xs tabular-nums text-hk-muted">{duration}</span>}
        <span
          aria-live="polite"
          className={cx(
            'shrink-0 text-xs',
            STATUS_TONE[part.status],
            part.status === 'success' || part.status === 'running' ? 'sr-only' : '',
          )}
        >
          {labels.status[part.status]}
        </span>
      </Collapsible.Trigger>

      {part.status === 'awaiting-permission' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-hk-warning/30 bg-hk-warning-subtle px-3 py-2">
          {risk && <RiskBadge risk={risk}>{labels.risk[risk]}</RiskBadge>}
          {part.permission?.reason && (
            <span className="min-w-0 flex-1 text-xs text-hk-fg">{part.permission.reason}</span>
          )}
          {onPermission && (
            <div className="ml-auto flex shrink-0 gap-1.5">
              <Button variant="ghost" onClick={() => onPermission('deny', 'once')}>
                {labels.deny}
              </Button>
              {risk !== 'high' && (
                <Button variant="secondary" onClick={() => onPermission('allow', 'always')}>
                  {labels.allowAlways}
                </Button>
              )}
              <Button variant="primary" onClick={() => onPermission('allow', 'once')}>
                {labels.allow}
              </Button>
            </div>
          )}
        </div>
      )}

      <Collapsible.Content className="border-t border-hk-border">
        {renderInput ? (
          renderInput(part)
        ) : (
          <Section label={labels.input}>
            {part.input === undefined ? part.inputText : stringify(part.input)}
            {inputStreaming && <Caret />}
          </Section>
        )}
        {showOutput &&
          (renderOutput ? (
            renderOutput(part)
          ) : (
            <Section label={labels.output} tone={part.status === 'error' ? 'danger' : undefined}>
              {outputText}
              {part.status === 'running' && <Caret />}
            </Section>
          ))}
        {part.status === 'error' && part.errorMessage && outputText === '' && (
          <Section label={labels.status.error} tone="danger">
            {part.errorMessage}
          </Section>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
