import type { AskAnswer, AskPart } from '@harnesskit/core';
import { Ban, Check, MessageCircleQuestion } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button, canTakeFocus, isTypingTarget, Kbd } from './ui';
import { cx } from './utils';

export interface AskUserCardLabels {
  chooseOne: string;
  chooseAny: string;
  recommended: string;
  other: string;
  otherPlaceholder: string;
  submit: string;
  errorEmpty: string;
  errorOther: string;
  question: string;
  cancelled: string;
}

export const defaultAskUserCardLabels: AskUserCardLabels = {
  chooseOne: 'Choose one',
  chooseAny: 'Choose any',
  recommended: 'Recommended',
  other: 'Other',
  otherPlaceholder: 'Type your answer',
  submit: 'Submit',
  errorEmpty: 'Choose an option first.',
  errorOther: 'Type your answer, or pick an option.',
  question: 'Question',
  cancelled: 'Question cancelled',
};

export interface AskUserCardProps {
  part: AskPart;
  /** Omit to render the question read-only. */
  onAnswer?: (askId: string, answer: AskAnswer) => void;
  /** Focus the first option when the question appears, unless the user is typing elsewhere. */
  autoFocus?: boolean;
  labels?: Partial<AskUserCardLabels>;
  className?: string;
}

/** Human-readable answer, e.g. "Typecheck, Unit tests, “Lint on push”". */
export function formatAskAnswer(part: AskPart, answer: AskAnswer | undefined = part.answer): string {
  if (!answer) return '';
  const chosen = part.options.filter((o) => answer.selected.includes(o.id)).map((o) => o.label);
  if (answer.other) chosen.push(`“${answer.other}”`);
  return chosen.join(', ');
}

/**
 * A question from the agent: single or multiple choice, optionally with a
 * free-text "Other". Keys while focused: `1`–`9` pick options, `Enter`
 * submits. Validation runs on submit and errors are shown inline.
 * Once answered or cancelled, the card collapses to a one-line summary.
 */
export function AskUserCard({ part, onAnswer, autoFocus = true, labels: overrides, className }: AskUserCardProps) {
  const labels = { ...defaultAskUserCardLabels, ...overrides };

  if (part.status !== 'pending') {
    const cancelled = part.status === 'cancelled';
    return (
      <section
        data-status={part.status}
        className={cx('flex items-start gap-2 rounded-hk border border-hk-border bg-hk-surface px-3 py-2 text-sm', className)}
      >
        {cancelled ? (
          <Ban aria-hidden className="mt-0.5 size-4 shrink-0 text-hk-muted" />
        ) : (
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-hk-success" />
        )}
        <div className="min-w-0">
          <p className="text-xs text-hk-muted">
            {part.header ?? labels.question} · {part.question}
          </p>
          <p className={cx('mt-0.5', cancelled ? 'text-hk-muted' : 'font-medium')}>
            {cancelled ? `${labels.cancelled}${part.cancelReason ? `: ${part.cancelReason}` : ''}` : formatAskAnswer(part)}
          </p>
        </div>
      </section>
    );
  }

  return <PendingAsk part={part} onAnswer={onAnswer} autoFocus={autoFocus} labels={labels} className={className} />;
}

function PendingAsk({
  part,
  onAnswer,
  autoFocus,
  labels,
  className,
}: Required<Pick<AskUserCardProps, 'part' | 'autoFocus'>> &
  Pick<AskUserCardProps, 'onAnswer' | 'className'> & { labels: AskUserCardLabels }) {
  const uid = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [otherOn, setOtherOn] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const otherInput = useRef<HTMLInputElement>(null);
  const readOnly = !onAnswer;
  const multi = part.multiSelect;

  useEffect(() => {
    if (autoFocus && !readOnly && canTakeFocus()) firstInput.current?.focus({ preventScroll: true });
  }, [autoFocus, readOnly]);

  const toggle = (id: string) => {
    setError(null);
    if (multi) {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    } else {
      setSelected([id]);
      setOtherOn(false);
    }
  };

  const toggleOther = (on: boolean) => {
    setError(null);
    setOtherOn(on);
    if (on && !multi) setSelected([]);
    if (on) requestAnimationFrame(() => otherInput.current?.focus());
  };

  const submit = () => {
    if (readOnly) return;
    if (otherOn && otherText.trim() === '') {
      setError(labels.errorOther);
      otherInput.current?.focus();
      return;
    }
    if (selected.length === 0 && !otherOn) {
      setError(labels.errorEmpty);
      return;
    }
    onAnswer(part.askId, otherOn ? { selected, other: otherText.trim() } : { selected });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Enter that confirms an IME candidate (e.g. Chinese pinyin) is not a submit.
    if (readOnly || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      const target = event.target as HTMLElement;
      // Buttons handle Enter themselves; the Other field submits.
      if (target.tagName === 'BUTTON') return;
      event.preventDefault();
      submit();
      return;
    }
    if (isTypingTarget(event) && (event.target as HTMLInputElement).type === 'text') return;
    const n = Number(event.key);
    if (Number.isInteger(n) && n >= 1 && n <= part.options.length) {
      event.preventDefault();
      toggle(part.options[n - 1]!.id);
    }
  };

  const errorId = `${uid}-error`;
  const optionRow =
    'flex cursor-pointer items-start gap-2.5 rounded-md border border-hk-border px-3 py-2 transition-colors hover:bg-hk-subtle has-[:checked]:border-hk-accent/60 has-[:checked]:bg-hk-accent/5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-hk-accent';

  return (
    <section
      data-status="pending"
      onKeyDown={onKeyDown}
      className={cx('overflow-hidden rounded-hk border border-hk-accent/40 bg-hk-surface text-sm text-hk-fg', className)}
    >
      <fieldset disabled={readOnly} aria-describedby={error ? errorId : undefined} className="min-w-0 space-y-1.5 px-3 pt-3 pb-2">
        <div className="mb-2 flex items-center gap-2">
          <MessageCircleQuestion aria-hidden className="size-4 shrink-0 text-hk-accent" />
          {part.header && (
            <span className="rounded-full bg-hk-subtle px-2 py-px text-[11px] font-medium text-hk-muted">{part.header}</span>
          )}
          <span className="ml-auto text-xs text-hk-muted">{multi ? labels.chooseAny : labels.chooseOne}</span>
        </div>
        <legend className="sr-only">{part.question}</legend>
        <p aria-hidden className="mb-2 font-medium leading-relaxed">
          {part.question}
        </p>

        {part.options.map((option, i) => (
          <label key={option.id} className={optionRow}>
            <input
              ref={i === 0 ? firstInput : undefined}
              type={multi ? 'checkbox' : 'radio'}
              name={uid}
              value={option.id}
              checked={selected.includes(option.id)}
              onChange={() => toggle(option.id)}
              className="mt-0.5 accent-hk-accent"
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{option.label}</span>
              {option.recommended && (
                <span className="ml-2 rounded-full bg-hk-accent/10 px-1.5 py-px text-[11px] font-medium text-hk-accent">
                  {labels.recommended}
                </span>
              )}
              {option.description && <span className="mt-0.5 block text-xs text-hk-muted">{option.description}</span>}
            </span>
            {i < 9 && <Kbd>{i + 1}</Kbd>}
          </label>
        ))}

        {part.allowOther && (
          <label className={optionRow}>
            <input
              ref={part.options.length === 0 ? firstInput : undefined}
              type={multi ? 'checkbox' : 'radio'}
              name={uid}
              checked={otherOn}
              onChange={(e) => toggleOther(multi ? e.target.checked : true)}
              className="mt-1.5 accent-hk-accent"
            />
            <span className="min-w-0 flex-1">
              <span className="sr-only">{labels.other}</span>
              <input
                ref={otherInput}
                type="text"
                value={otherText}
                placeholder={labels.otherPlaceholder}
                aria-label={labels.other}
                aria-invalid={error === labels.errorOther || undefined}
                onChange={(e) => {
                  setOtherText(e.target.value);
                  setError(null);
                  if (!otherOn) toggleOther(true);
                }}
                className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 outline-none placeholder:text-hk-muted focus:border-hk-border"
              />
            </span>
          </label>
        )}
      </fieldset>

      <footer className="flex items-center gap-2 px-3 pb-3">
        <p id={errorId} role="alert" className="min-h-[1em] flex-1 text-xs text-hk-danger">
          {error}
        </p>
        {!readOnly && (
          <Button variant="primary" shortcut="↵" onClick={submit}>
            {labels.submit}
          </Button>
        )}
      </footer>
    </section>
  );
}
