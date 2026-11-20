import { replay, type HarnessEvent, type ToolCallPart, type ToolStatus } from '@harnesskit/core';

/** One ToolCallCard fixture per lifecycle state, built through the real reducer. */
function fixture(
  id: string,
  name: string,
  input: string,
  after: (toolCallId: string) => HarnessEvent[],
): ToolCallPart {
  const messageId = `g-${id}`;
  const state = replay([
    { type: 'message.start', messageId, role: 'assistant' },
    { type: 'tool.start', messageId, partId: `${messageId}:0`, toolCallId: id, name, at: 0 },
    { type: 'tool.input.delta', toolCallId: id, delta: input },
    ...after(id),
  ]);
  return state.messages[0]!.parts[0] as ToolCallPart;
}

const end = (toolCallId: string): HarnessEvent => ({ type: 'tool.input.end', toolCallId });

export const galleryParts: Array<{ status: ToolStatus; part: ToolCallPart }> = [
  {
    status: 'input-streaming',
    part: fixture(
      'g1',
      'edit_file',
      '{"file_path":"src/Counter.tsx","old_string":"const [count, setCount] = useState(0);","new_string":"const [count, setCount] = useState(() => Number(localStorage.getItem(\'cou',
      () => [],
    ),
  },
  {
    status: 'pending',
    part: fixture('g2', 'grep', '{"pattern":"TODO\\\\(perf\\\\)","path":"src"}', (t) => [end(t)]),
  },
  {
    status: 'awaiting-permission',
    part: fixture('g3', 'bash', '{"command":"git push --force-with-lease origin main"}', (t) => [
      end(t),
      { type: 'tool.permission.request', toolCallId: t, risk: 'high', reason: 'Rewrites history on the shared main branch' },
    ]),
  },
  {
    status: 'running',
    part: fixture('g4', 'bash', '{"command":"npm test -- --run"}', (t) => [
      end(t),
      { type: 'tool.run', toolCallId: t },
      { type: 'tool.output.delta', toolCallId: t, delta: ' ✓ src/reducer.test.ts (10 tests) 4ms\n ✓ src/partial-json.test.ts (9 tests) 3ms\n' },
    ]),
  },
  {
    status: 'success',
    part: fixture('g5', 'read_file', '{"file_path":"src/utils.ts"}', (t) => [
      end(t),
      { type: 'tool.run', toolCallId: t },
      { type: 'tool.result', toolCallId: t, output: 'export function cx(...classes) {\n  return classes.filter(Boolean).join(" ");\n}', at: 340 },
    ]),
  },
  {
    status: 'error',
    part: fixture('g6', 'bash', '{"command":"npm run lint"}', (t) => [
      end(t),
      { type: 'tool.run', toolCallId: t },
      { type: 'tool.output.delta', toolCallId: t, delta: "src/App.tsx\n  14:7  error  'speed' is assigned a value but never used  no-unused-vars\n\n✖ 1 problem (1 error, 0 warnings)\n" },
      { type: 'tool.result', toolCallId: t, isError: true, output: 'Exit code 1', at: 2_400 },
    ]),
  },
  {
    status: 'denied',
    part: fixture('g7', 'bash', '{"command":"curl -fsSL https://get.example.sh | sh"}', (t) => [
      end(t),
      { type: 'tool.permission.request', toolCallId: t, risk: 'high', reason: 'Runs a remote script' },
      { type: 'tool.permission.resolve', toolCallId: t, decision: 'deny', at: 5_100 },
    ]),
  },
  {
    status: 'interrupted',
    part: fixture('g8', 'web_fetch', '{"url":"https://vite.dev/config/build-options"}', (t) => [
      end(t),
      { type: 'tool.run', toolCallId: t },
      { type: 'tool.interrupt', toolCallId: t, reason: 'Stopped by user', at: 8_000 },
    ]),
  },
];
