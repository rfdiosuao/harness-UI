import type { ToolCallPart } from './protocol';

/** Commands whose second word says what they do (`npm run`, `git push`, …). */
const SUBCOMMAND_TOOLS = new Set([
  'npm', 'pnpm', 'yarn', 'bun', 'npx', 'git', 'gh', 'cargo', 'go', 'make',
  'pip', 'uv', 'poetry', 'docker', 'kubectl', 'terraform', 'deno',
]);

/** Shell syntax that makes a prefix rule unsafe: anything could follow it. */
const SHELL_OPERATORS = /[;&|<>`$()\n]/;

/**
 * Suggests the rule an "always allow" decision should store, as
 * `tool(pattern)`. Conservative by design: a command containing shell
 * operators is only ever matched exactly, because `npm test && rm -rf ~`
 * must not be covered by a rule for `npm test`. The harness owns the real
 * matching; this only proposes what to show the user.
 */
export function suggestAlwaysRule(part: ToolCallPart): string {
  const input = (part.input && typeof part.input === 'object' ? part.input : {}) as Record<string, unknown>;
  const name = part.name;

  if (typeof input.command === 'string') {
    const command = input.command.trim();
    if (SHELL_OPERATORS.test(command)) return `${name}(${command})`;
    const [program, sub] = command.split(/\s+/);
    if (!program) return `${name}(*)`;
    if (SUBCOMMAND_TOOLS.has(program) && sub && !sub.startsWith('-')) {
      // `npm run build` → `npm run *`, `git status -s` → `git status *`
      return `${name}(${program} ${sub} *)`;
    }
    return `${name}(${command})`;
  }

  const path = [input.file_path, input.path].find((v): v is string => typeof v === 'string');
  if (path) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
    return `${name}(${dir || '/'}/**)`;
  }

  if (typeof input.url === 'string') {
    try {
      return `${name}(${new URL(input.url).host})`;
    } catch {
      return `${name}(${input.url})`;
    }
  }

  return `${name}(*)`;
}
