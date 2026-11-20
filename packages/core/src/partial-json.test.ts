import { describe, expect, it } from 'vitest';
import { parsePartialJson } from './partial-json';

describe('parsePartialJson', () => {
  it('parses complete documents exactly like JSON.parse', () => {
    const docs = ['{}', '[]', '{"a":[1,2,{"b":null}],"c":"x\\ny","d":-1.5e3,"e":true}', '  "s"  ', '0'];
    for (const doc of docs) {
      expect(parsePartialJson(doc)).toEqual({ value: JSON.parse(doc), complete: true });
    }
  });

  it('returns undefined before anything usable arrives', () => {
    expect(parsePartialJson('')).toEqual({ value: undefined, complete: false });
    expect(parsePartialJson('  ')).toEqual({ value: undefined, complete: false });
    expect(parsePartialJson('tr').value).toBeUndefined();
  });

  it('streams open strings as far as they go', () => {
    expect(parsePartialJson('{"command":"rm -rf di').value).toEqual({ command: 'rm -rf di' });
    expect(parsePartialJson('"hello wor').value).toBe('hello wor');
  });

  it('drops half-written keys and keys without a value', () => {
    expect(parsePartialJson('{"a":1,"comm').value).toEqual({ a: 1 });
    expect(parsePartialJson('{"a":1,"command"').value).toEqual({ a: 1 });
    expect(parsePartialJson('{"a":1,"command":').value).toEqual({ a: 1 });
    expect(parsePartialJson('{"a":1,').value).toEqual({ a: 1 });
  });

  it('omits literals and numbers that are not yet valid', () => {
    expect(parsePartialJson('{"ok":tru').value).toEqual({});
    expect(parsePartialJson('{"n":-').value).toEqual({});
    expect(parsePartialJson('{"n":1.').value).toEqual({});
    expect(parsePartialJson('{"n":12').value).toEqual({ n: 12 });
    expect(parsePartialJson('[1,2,nu').value).toEqual([1, 2]);
  });

  it('handles nested truncation', () => {
    expect(parsePartialJson('{"edits":[{"old":"a","new":"b"},{"old":"c').value).toEqual({
      edits: [{ old: 'a', new: 'b' }, { old: 'c' }],
    });
  });

  it('never surfaces half an escape sequence', () => {
    expect(parsePartialJson('"a\\').value).toBe('a');
    expect(parsePartialJson('"a\\u00').value).toBe('a');
    expect(parsePartialJson('"a\\u00e9').value).toBe('aé');
    expect(parsePartialJson('"\\ud83d').value).toBe(''); // lone high surrogate
    expect(parsePartialJson('"\\ud83d\\ude00"').value).toBe('😀');
  });

  it('reports input that can never become valid JSON', () => {
    for (const bad of ['{a:1}', '{"a":1,}', '[1 2]', '01', '"\\x"', '{"a":1}}', 'nope']) {
      const result = parsePartialJson(bad);
      expect(result.error, bad).toBeTypeOf('string');
      expect(result.complete).toBe(false);
    }
  });

  it('agrees with JSON.parse on every prefix of a real tool input', () => {
    const input = { file_path: 'src/app.ts', edits: [{ old_string: 'const a = 1;', new_string: 'const a = "é\n";' }], dry_run: false, retries: 3 };
    const text = JSON.stringify(input);
    for (let i = 0; i <= text.length; i++) {
      const result = parsePartialJson(text.slice(0, i));
      expect(result.error, `prefix ${i}`).toBeUndefined();
      expect(result.complete, `prefix ${i}`).toBe(i === text.length);
    }
    expect(parsePartialJson(text)).toEqual({ value: input, complete: true });
  });
});
