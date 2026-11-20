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

Every event accepts an optional `at` timestamp (epoch ms), used only for durations.

## Roadmap

**MVP components**

- [x] `ToolCallCard`: full lifecycle, inline approval, streaming input and output
- [x] `StreamingMarkdown`: GFM rendering that repairs the unfinished tail, so half-written bold, code, links and fences never flash raw markers; only the block still streaming re-renders; raw HTML is shown as text and URLs are allow-listed
- [ ] `StreamingMarkdown` follow-ups: syntax highlighting (the `CodeBlock` slot is ready for Shiki), math, footnotes, incremental lexing for very long messages
- [ ] `ThinkingBlock`: collapsible reasoning with duration (a minimal version lives in the playground)
- [ ] `PermissionPrompt`: standalone approval surface for modal or queue-style UIs
- [ ] `PlanList`: task list with progress

**Next**

- [ ] `DiffView`, `TerminalOutput`, `FileChip`, `AskUserCard`, `SubagentCard`, `ContextMeter`, `InterruptBar`
- [ ] Grouping consecutive tool calls; a virtualized `Transcript`
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
