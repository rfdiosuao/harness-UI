import { describe, expect, it } from 'vitest';
import { repairMarkdown } from './markdown';

const cases: Array<[string, string, string]> = [
  // [description, streamed so far, repaired]
  ['complete text is unchanged', 'Hello **world** and `code`.', 'Hello **world** and `code`.'],
  ['open bold', 'This is **impor', 'This is **impor**'],
  ['open italic', 'This is *very', 'This is *very*'],
  ['italic inside bold', 'A **bold *and ital', 'A **bold *and ital***'],
  ['bold inside italic', 'A *ital **bo', 'A *ital **bo***'],
  ['strikethrough', 'Not ~~this', 'Not ~~this~~'],
  ['half a strikethrough closer', 'Not ~~this~', 'Not ~~this~~'],
  ['half a bold closer', 'A **bold*', 'A **bold**'],
  ['lone tilde is literal', 'cd ~', 'cd ~'],
  ['closer touches text', 'Say **hi ', 'Say **hi**'],
  ['dangling opener is dropped', 'Hello **', 'Hello '],
  ['dangling opener after text is dropped', 'Use *', 'Use '],
  ['literal asterisks are left alone', 'Compute 2 * 3 and 4 * 5', 'Compute 2 * 3 and 4 * 5'],
  ['list markers are not emphasis', '* first\n* sec', '* first\n* sec'],
  ['escaped markers are ignored', 'A \\*literal\\* star', 'A \\*literal\\* star'],
  ['open inline code', 'Run `npm ru', 'Run `npm ru`'],
  ['open double-backtick code', 'See ``a ` b', 'See ``a ` b``'],
  ['dangling backtick is dropped', 'Run `', 'Run '],
  ['emphasis outside open code closes after it', '**Run `npm ru', '**Run `npm ru`**'],
  ['markers inside code are ignored', 'Use `a**b` now', 'Use `a**b` now'],
  ['bold wrapping a finished code span', 'With **`--flag`', 'With **`--flag`**'],
  ['open link bracket', 'See [the do', 'See the do'],
  ['open link destination', 'See [the docs](https://vite.d', 'See the docs'],
  ['complete link', 'See [docs](https://vite.dev/a_b*c).', 'See [docs](https://vite.dev/a_b*c).'],
  ['bracketed text may be literal', 'Item [1]', 'Item [1]'],
  ['partial image is dropped', 'Look ![diag', 'Look '],
  ['partial image destination is dropped', 'Look ![d](https://x', 'Look '],
  ['open fence', 'Code:\n\n```ts\nconst a = 1', 'Code:\n\n```ts\nconst a = 1\n```'],
  ['open fence ending in newline', '```\nx\n', '```\nx\n```'],
  ['half-typed closing fence', '```\nx\n``', '```\nx\n```'],
  ['opening fence alone', 'Code:\n```', 'Code:\n```\n```'],
  ['open tilde fence', '~~~~py\nprint(1)', '~~~~py\nprint(1)\n~~~~'],
  ['markers inside an open fence are untouched', '```\n**x `y', '```\n**x `y\n```'],
  ['closed fence does not leak', '```\nlet x = `\n```\nAfter **b', '```\nlet x = `\n```\nAfter **b**'],
  ['only the last block is repaired', 'A **b\n\nC *d', 'A **b\n\nC *d*'],
  ['list items scope to their line', '- a **b\n- c *d', '- a **b\n- c *d*'],
  ['multi-line paragraph keeps its opener', 'Some **bold\ncontinues', 'Some **bold\ncontinues**'],
  ['table cell', '| a | b |\n|---|---|\n| **x', '| a | b |\n|---|---|\n| **x**'],
  ['bare url with stars', 'See https://x.com/*a', 'See https://x.com/*a'],
];

describe('repairMarkdown', () => {
  it.each(cases)('%s', (_, input, expected) => {
    expect(repairMarkdown(input)).toBe(expected);
  });

  it('is idempotent on its own output', () => {
    for (const [, input] of cases) {
      const once = repairMarkdown(input);
      expect(repairMarkdown(once), input).toBe(once);
    }
  });
});
