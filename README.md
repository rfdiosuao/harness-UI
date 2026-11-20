# harnesskit

UI building blocks for **agent harnesses**: the apps where a model streams thinking, calls tools, asks for permission, and runs for hundreds of steps.

Chat component libraries cover messages well. Agent UIs need more:

- **Everything streams.** Half-written Markdown, half-written tool-input JSON, output arriving line by line.
- **Tool calls are state machines.** Preparing → queued → needs approval → running → done, failed, denied or interrupted.
- **Transcripts are long.** Hundreds of steps need collapsing, grouping and virtualization.
- **Humans step in.** Approvals, questions and interrupts are first-class, not afterthoughts.

> Status: early prototype (v0.0.0). The protocol may still change.

## Packages

| Package | What it is |
| --- | --- |
| [`@harnesskit/core`](packages/core) | Framework-agnostic event protocol, a pure transcript reducer, a tolerant streaming-JSON parser, and provider adapters (Anthropic today). No UI. |
| [`@harnesskit/react`](packages/react) | React components and hooks styled with Tailwind v4 and themeable via `--hk-*` CSS variables. |
| [`apps/playground`](apps/playground) | A scripted agent run streamed through the real adapter and reducer, plus every ToolCallCard state. |

## How it fits together

```
provider stream ──▶ adapter ──┐
                              ├─▶ HarnessEvent ─▶ reduceTranscript ─▶ TranscriptState ─▶ components
your tool runner ─────────────┘
```

Components never see provider-specific data. An adapter translates a provider's stream (`content_block_delta`, …) into a small set of `HarnessEvent`s. Your harness emits the events no provider knows about: permission requests, execution, output and results. The reducer is pure and never reads the clock, so a recorded event log always replays to the same transcript.

### Tool call lifecycle

```
input-streaming ─▶ pending ─┬─▶ awaiting-permission ─┬─▶ running ─┬─▶ success
       │                    │                        └─▶ denied   └─▶ error
       └─▶ error            └─▶ running / success / error
any non-terminal state ─▶ interrupted
```

The reducer ignores illegal transitions instead of corrupting state, and records each one in `state.warnings`.

## Quick start

```tsx
import { createAnthropicAdapter } from '@harnesskit/core/anthropic';
import { ToolCallCard, useTranscript } from '@harnesskit/react';
import '@harnesskit/react/theme.css'; // after @import "tailwindcss"

const { state, dispatch } = useTranscript();
const translate = createAnthropicAdapter();

for await (const event of client.beta.messages.stream({ /* … */ })) {
  dispatch(translate(event));
}
// then, from your tool runner:
dispatch({ type: 'tool.permission.request', toolCallId, risk: 'high', reason: 'Deletes files' });
```

```tsx
<ToolCallCard
  part={toolPart}
  onPermission={(decision, scope) => dispatch({ type: 'tool.permission.resolve', toolCallId: toolPart.toolCallId, decision, scope })}
/>
```

### Human in the loop

Three ways for a person to step in, built on the same events and selectors:

```tsx
import { pendingPermissions, runStatus } from '@harnesskit/core';

<PermissionPrompt
  requests={pendingPermissions(state)}
  onResolve={(toolCallId, decision, scope, rule) =>
    dispatch({ type: 'tool.permission.resolve', toolCallId, decision, scope, rule })}
/>

<AskUserCard part={askPart} onAnswer={(askId, answer) => dispatch({ type: 'ask.answer', askId, answer })} />

<InterruptBar
  status={runStatus(state)}            // 'idle' | 'running' | 'waiting'
  onInterrupt={() => dispatch({ type: 'turn.interrupt' })}
  queue={state.queue}
  onRemoveQueued={(queueId) => dispatch({ type: 'queue.remove', queueId })}
/>
```

- **`PermissionPrompt`** works through pending approvals one at a time. `y` / `a` / `n` while focused. High-risk calls turn shortcuts and "Always allow" off and need a click. "Allow all" only appears when nothing in the queue is high risk. "Always allow" previews the rule it will save (`suggestAlwaysRule` never generalizes a command containing shell operators).
- **`AskUserCard`** renders a question inline: native radios or checkboxes, `1`–`9` to pick, `Enter` to submit (but not while an IME is composing), an optional free-text "Other", inline validation, and a one-line summary once answered.
- **`InterruptBar`** shows whether the agent is working or waiting for you, stops it on `Esc` (ignored on key repeat, during IME composition, and when another handler already took the key), and lists queued messages.

None of them steal focus from someone typing elsewhere.

### Status and cost

```tsx
import { activeError, contextTokens, errorEventFrom, estimateCost } from '@harnesskit/core';

<ContextMeter used={contextTokens(state)} limit={contextWindow} />
<CostTicker estimate={estimateCost(state, prices)} budget={5} />
<ErrorBanner error={activeError(state)} onRetry={retryNow} onDismiss={dismiss} />
// inside a message, for `part.kind === 'fallback'`:
<FallbackNotice part={part} formatModel={displayName} />

// when a request throws:
catch (err) { dispatch(errorEventFrom(err, { errorId, attempt, maxAttempts: 5 })); }
```

- **`ContextMeter`**: a ring that turns to warning at 80% and danger at 95%, with a proper `role="meter"`. You pass the context window (for example from the provider's models API), so nothing is hardcoded per model.
- **`CostTicker`**: running spend with a per-model breakdown, an optional budget, and updates throttled so the number doesn't flicker. harnesskit ships **no price table**: you pass your own. Tokens without a known price are never guessed at; the total is then shown as a lower bound (`≥$0.42`).
- **`ErrorBanner`**: what went wrong and what happens next: a live retry countdown, the attempt number, "Retry now" and "Dismiss". Transient problems (rate limits, overload, network) use the warning tone; refusals, auth and bad requests use danger.
- **`FallbackNotice`**: marks where another model took over in a message, e.g. after a server-side fallback.
- **`errorEventFrom`** maps thrown SDK errors to `error` events without importing any SDK: HTTP status → kind, `retry-after` (seconds or a date, from `Headers` or a plain object) → retry time, with exponential backoff otherwise, and no retry once the last attempt fails.

Limitation: with server-side fallbacks, providers can bill each attempt separately (Anthropic reports this in `usage.iterations`). `estimateCost` currently uses the top-level usage each message reports.

### Markdown

Assistant text goes through `StreamingMarkdown`:

```tsx
<StreamingMarkdown text={part.text} streaming={part.streaming} />
```

`repairMarkdown` (in `@harnesskit/core`) is the framework-agnostic part: a pure function that closes what the end of a half-streamed document leaves open. Use it with any Markdown renderer.

A complete, typechecked agent loop (streaming, approval, execution, tool results) is in [`examples/anthropic-agent.ts`](examples/anthropic-agent.ts).

## Event protocol

| Event | Emitted by | Effect |
| --- | --- | --- |
| `message.start` / `message.end` | adapter | Opens or closes a message. A `max_tokens` stop marks unfinished tool input as `error`. |
| `part.start` / `part.end` | adapter | Opens or closes a text or thinking part. |
| `text.delta` / `thinking.delta` | adapter | Appends streamed text. |
| `tool.start` | adapter | New tool call in `input-streaming`. |
| `tool.input.delta` | adapter | Appends input JSON; `input` is re-parsed progressively. |
| `tool.input.end` | adapter | Final parse → `pending` (or `error` if the JSON is invalid). |
| `tool.permission.request` | harness | → `awaiting-permission`, with optional `risk` and `reason`. |
| `tool.permission.resolve` | harness / UI | `allow` → `running`, `deny` → `denied`. `scope: 'always'` is a hint to remember the choice. |
| `tool.run` | harness | → `running` (for calls that skip approval). |
| `tool.output.delta` | harness | Appends streamed output, for example terminal lines. |
| `tool.result` | harness / adapter | → `success` or `error`. Server tools resolve from the stream. |
| `tool.interrupt` | harness | → `interrupted`. |
| `ask.request` | harness | The agent asks the user a question: options, single or multi-select, optional free text. |
| `ask.answer` / `ask.cancel` | UI / harness | Answers are validated against the question; invalid ones are ignored with a warning. |
| `turn.interrupt` | UI | The user stopped the agent: ends streaming messages, interrupts unfinished tools, cancels open questions. |
| `queue.add` / `queue.remove` | UI / harness | Messages typed while the agent was busy, sent when it's ready. |
| `usage` | adapter | Token usage for a message; reported fields replace earlier values. |
| `model.fallback` | adapter | Another model took over mid-message; adds a switch-point part. |
| `error` | harness / adapter | Reports an error or updates it by id (next attempt, new retry time). Refusals arrive this way. |
| `error.retry` / `error.resolve` | harness | A retry is in flight; the error recovered or was dismissed. |

Every event accepts an optional `at` timestamp (epoch ms), used only for durations.

## Roadmap

**MVP components**

- [x] `ToolCallCard`: full lifecycle, inline approval, streaming input and output
- [x] `StreamingMarkdown`: GFM rendering that repairs the unfinished tail, so half-written bold, code, links and fences never flash raw markers; only the block still streaming re-renders; raw HTML is shown as text and URLs are allow-listed
- [ ] `StreamingMarkdown` follow-ups: syntax highlighting (the `CodeBlock` slot is ready for Shiki), math, footnotes, incremental lexing for very long messages
- [x] Human-in-the-loop suite: `PermissionPrompt`, `AskUserCard`, `InterruptBar`
- [x] Status and cost suite: `ContextMeter`, `CostTicker`, `ErrorBanner`, `FallbackNotice`

**Next**

- [ ] Long-transcript suite: `Transcript`, `ToolCallGroup`, `ThinkingBlock`
- [ ] Coding-agent suite: `DiffView`, `TerminalOutput`, `FileChip`
- [ ] Multi-agent suite: `SubagentCard`, `PlanList`
- [ ] Per-attempt billing for fallbacks (`usage.iterations`)
- [ ] Input and sources suite: `Composer`, `CitationChip`
- [ ] Adapters for the OpenAI Responses API and the Vercel AI SDK UI message stream
- [ ] An incremental partial-JSON parser (the current one re-parses the whole buffer on each delta)
- [ ] shadcn-style registry so components can be copied into your project
- [ ] A **vocabulary card** per component (name, when to use, anti-patterns, a prompt snippet), plus `llms.txt` and an MCP server, so coding agents can use the library as precisely as people can
- [ ] Storybook and visual regression tests

## Development

```bash
npm install
npm test           # vitest
npm run typecheck  # tsc
npm run dev        # playground on http://localhost:5173
```

## License

[MIT](LICENSE)
