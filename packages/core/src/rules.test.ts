import { describe, expect, it } from 'vitest';
import type { ToolCallPart } from './protocol';
import { suggestAlwaysRule } from './rules';

const part = (name: string, input: unknown) => ({ name, input }) as ToolCallPart;

describe('suggestAlwaysRule', () => {
  it.each([
    ['bash', { command: 'npm run build' }, 'bash(npm run *)'],
    ['bash', { command: 'git status -s' }, 'bash(git status *)'],
    ['bash', { command: 'git --no-pager log' }, 'bash(git --no-pager log)'],
    ['bash', { command: 'rm -rf dist' }, 'bash(rm -rf dist)'],
    ['bash', { command: 'npm test; rm -rf ~' }, 'bash(npm test; rm -rf ~)'],
    ['bash', { command: 'echo $(whoami)' }, 'bash(echo $(whoami))'],
    ['write_file', { file_path: 'src/app/page.tsx' }, 'write_file(src/app/**)'],
    ['write_file', { file_path: 'README.md' }, 'write_file(./**)'],
    ['web_fetch', { url: 'https://vite.dev/config/' }, 'web_fetch(vite.dev)'],
    ['list_tools', {}, 'list_tools(*)'],
  ])('%s %j → %s', (name, input, rule) => {
    expect(suggestAlwaysRule(part(name, input))).toBe(rule);
  });
});
