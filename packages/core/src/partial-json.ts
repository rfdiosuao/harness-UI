/**
 * Tolerant JSON parser for streamed tool inputs.
 *
 * Given any prefix of a valid JSON document it returns the most useful value
 * it can: open strings are returned as far as they go (so a streaming file
 * body shows up live), keys without a value yet are left out, and
 * half-written literals or numbers (`tru`, `1.`) are omitted until they
 * complete. Input that cannot be the prefix of valid JSON is reported in
 * `error` rather than guessed at.
 */

export interface PartialJsonResult {
  /** Best-effort value; `undefined` when nothing usable has arrived yet. */
  value: unknown;
  /** True only when `text` is a complete, valid JSON document. */
  complete: boolean;
  /** Set when `text` is not a prefix of any valid JSON document. */
  error?: string;
}

const OMIT: unique symbol = Symbol('omit');
type Parsed = unknown | typeof OMIT;

const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

const LITERALS: ReadonlyArray<[string, unknown]> = [
  ['true', true],
  ['false', false],
  ['null', null],
];

const STRICT_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
/** Strings that more characters could still turn into a valid number. */
const NUMBER_PREFIX =
  /^-?$|^-?(?:0|[1-9]\d*)\.?$|^-?(?:0|[1-9]\d*)\.\d+$|^-?(?:0|[1-9]\d*)(?:\.\d+)?[eE][+-]?\d*$/;
const LOOSE_NUMBER = /-?\d*(?:\.\d*)?(?:[eE][+-]?\d*)?/y;

class Parser {
  i = 0;
  depth = 0;
  /** Set once the parser runs off the end of the input mid-value. */
  truncated = false;

  constructor(private readonly s: string) {}

  eof(): boolean {
    return this.i >= this.s.length;
  }

  ws(): void {
    while (!this.eof()) {
      const c = this.s.charCodeAt(this.i);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return;
      this.i++;
    }
  }

  fail(message: string): never {
    throw new SyntaxError(`${message} at position ${this.i}`);
  }

  value(): Parsed {
    this.ws();
    if (this.eof()) {
      this.truncated = true;
      return OMIT;
    }
    const c = this.s[this.i]!;
    if (c === '{' || c === '[') {
      this.depth++;
      const v = c === '{' ? this.object() : this.array();
      this.depth--;
      return v;
    }
    if (c === '"') return this.string();
    if (c === '-' || (c >= '0' && c <= '9')) return this.number();
    return this.literal();
  }

  object(): Record<string, unknown> {
    this.i++; // {
    const out: Record<string, unknown> = {};
    this.ws();
    if (this.eof()) return this.cut(out);
    if (this.s[this.i] === '}') {
      this.i++;
      return out;
    }
    for (;;) {
      this.ws();
      if (this.eof()) return this.cut(out);
      if (this.s[this.i] !== '"') this.fail('Expected string key');
      const key = this.string();
      if (this.truncated) return out; // half a key is not a key
      this.ws();
      if (this.eof()) return this.cut(out);
      if (this.s[this.i] !== ':') this.fail("Expected ':'");
      this.i++;
      const v = this.value();
      if (v !== OMIT) out[key] = v;
      if (this.truncated) return out;
      this.ws();
      if (this.eof()) return this.cut(out);
      const c = this.s[this.i];
      if (c === '}') {
        this.i++;
        return out;
      }
      if (c !== ',') this.fail("Expected ',' or '}'");
      this.i++;
    }
  }

  array(): unknown[] {
    this.i++; // [
    const out: unknown[] = [];
    this.ws();
    if (this.eof()) return this.cut(out);
    if (this.s[this.i] === ']') {
      this.i++;
      return out;
    }
    for (;;) {
      const v = this.value();
      if (v !== OMIT) out.push(v);
      if (this.truncated) return out;
      this.ws();
      if (this.eof()) return this.cut(out);
      const c = this.s[this.i];
      if (c === ']') {
        this.i++;
        return out;
      }
      if (c !== ',') this.fail("Expected ',' or ']'");
      this.i++;
    }
  }

  string(): string {
    this.i++; // opening quote
    let out = '';
    for (;;) {
      const start = this.i;
      while (!this.eof()) {
        const code = this.s.charCodeAt(this.i);
        if (code === 0x22 /* " */ || code === 0x5c /* \ */) break;
        if (code < 0x20) this.fail('Unescaped control character in string');
        this.i++;
      }
      out += this.s.slice(start, this.i);
      if (this.eof()) return this.cutString(out);

      if (this.s[this.i] === '"') {
        this.i++;
        return out;
      }

      // Backslash escape.
      const esc = this.s[this.i + 1];
      if (esc === undefined) {
        this.i = this.s.length;
        return this.cutString(out);
      }
      if (esc === 'u') {
        const hex = this.s.slice(this.i + 2, this.i + 6);
        if (!/^[0-9a-fA-F]*$/.test(hex)) this.fail('Invalid unicode escape');
        if (hex.length < 4) {
          this.i = this.s.length;
          return this.cutString(out);
        }
        out += String.fromCharCode(parseInt(hex, 16));
        this.i += 6;
        continue;
      }
      const mapped = ESCAPES[esc];
      if (mapped === undefined) this.fail(`Invalid escape \\${esc}`);
      out += mapped;
      this.i += 2;
    }
  }

  number(): Parsed {
    LOOSE_NUMBER.lastIndex = this.i;
    const token = LOOSE_NUMBER.exec(this.s)![0];
    this.i += token.length;
    const valid = STRICT_NUMBER.test(token);
    if (this.eof()) {
      if (!NUMBER_PREFIX.test(token)) this.fail(`Invalid number ${JSON.stringify(token)}`);
      // A bare top-level number is a complete document; anywhere else more
      // digits may still be coming.
      if (this.depth > 0 || !valid) this.truncated = true;
      return valid ? Number(token) : OMIT;
    }
    if (!valid) this.fail(`Invalid number ${JSON.stringify(token)}`);
    return Number(token);
  }

  literal(): Parsed {
    const rest = this.s.slice(this.i);
    for (const [word, value] of LITERALS) {
      if (rest.startsWith(word)) {
        this.i += word.length;
        return value;
      }
      if (word.startsWith(rest)) {
        this.i = this.s.length;
        this.truncated = true;
        return OMIT;
      }
    }
    return this.fail(`Unexpected token ${JSON.stringify(this.s[this.i])}`);
  }

  private cut<T>(value: T): T {
    this.truncated = true;
    return value;
  }

  private cutString(value: string): string {
    this.truncated = true;
    // Don't surface half of a surrogate pair.
    const last = value.charCodeAt(value.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? value.slice(0, -1) : value;
  }
}

export function parsePartialJson(text: string): PartialJsonResult {
  const parser = new Parser(text);
  try {
    parser.ws();
    if (parser.eof()) return { value: undefined, complete: false };
    const value = parser.value();
    const usable = value === OMIT ? undefined : value;
    if (parser.truncated) return { value: usable, complete: false };
    parser.ws();
    if (!parser.eof()) parser.fail('Unexpected data after JSON value');
    return { value: usable, complete: true };
  } catch (err) {
    if (err instanceof SyntaxError) return { value: undefined, complete: false, error: err.message };
    throw err;
  }
}
