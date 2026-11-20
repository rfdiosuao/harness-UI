import type { RiskLevel } from '@harnesskit/core';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-hk-accent text-hk-accent-fg hover:opacity-90',
  secondary: 'border border-hk-border bg-hk-surface hover:bg-hk-subtle',
  ghost: 'text-hk-muted hover:bg-hk-subtle hover:text-hk-fg',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; shortcut?: string }
>(function Button({ variant = 'secondary', shortcut, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-keyshortcuts={shortcut}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hk-accent',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
      {shortcut && <Kbd tone={variant === 'primary' ? 'inverse' : 'default'}>{shortcut}</Kbd>}
    </button>
  );
});

export function Kbd({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'inverse' }) {
  return (
    <kbd
      aria-hidden
      className={cx(
        'hidden min-w-[1.4em] rounded px-1 text-center font-mono text-[10px] leading-[1.6] sm:inline-block',
        tone === 'inverse' ? 'bg-hk-accent-fg/20' : 'border border-hk-border text-hk-muted',
      )}
    >
      {children}
    </kbd>
  );
}

const RISK_TONE: Record<RiskLevel, string> = {
  low: 'border-hk-border text-hk-muted',
  medium: 'border-hk-warning/40 text-hk-warning',
  high: 'border-hk-danger/40 text-hk-danger',
};

export function RiskBadge({ risk, children }: { risk: RiskLevel; children: ReactNode }) {
  return (
    <span className={cx('shrink-0 rounded-full border px-2 py-px text-[11px] font-medium', RISK_TONE[risk])}>
      {children}
    </span>
  );
}

/** True when keyboard shortcuts should leave the event alone (typing, IME). */
export function isTypingTarget(event: KeyboardEvent | React.KeyboardEvent): boolean {
  const native = 'nativeEvent' in event ? event.nativeEvent : event;
  if (native.isComposing) return true;
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** Don't steal focus from someone typing elsewhere on the page. */
export function canTakeFocus(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return true;
  return !(active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
}
