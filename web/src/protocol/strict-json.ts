// SPDX-License-Identifier: GPL-3.0-or-later

// The strict JSON of the protocol (docs/protocol/protocol-v1.md#lines), the same rules as `strict_json` in
// tools/zenit.py. The browser's JSON.parse is not enough: it takes a key named twice (the last wins) and cannot tell
// `1` from `1.0`, which integer fields must.

/** A number written with a fraction or an exponent. Integer fields refuse it; fields that take any number accept it. */
export class JsonFloat {
  constructor(readonly value: number) {}
}

export type JsonValue = null | boolean | number | JsonFloat | string | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export class JsonError extends Error {}

/** Nesting a reply may have. The protocol bounds requests at 4; replies are bounded here so a hostile one cannot
 * exhaust the stack. */
export const MAX_DEPTH = 64;

const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/** The decoder that refuses invalid UTF-8 and keeps a byte order mark, which JSON does not allow. */
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

class Reader {
  private at = 0;

  constructor(private readonly text: string) {}

  fail(what: string): never {
    throw new JsonError(`${what} at ${this.at}`);
  }

  private blank(): void {
    while (this.text[this.at] === " " || this.text[this.at] === "\t") this.at++;
  }

  document(): JsonObject {
    this.blank();
    if (this.text[this.at] !== "{") this.fail("not an object");
    const value = this.value(0) as JsonObject;
    this.blank();
    if (this.at !== this.text.length) this.fail("text after the object");
    return value;
  }

  private value(depth: number): JsonValue {
    this.blank();
    const char = this.text[this.at];
    if (char === "{") return this.object(depth + 1);
    if (char === "[") return this.array(depth + 1);
    if (char === '"') return this.string();
    if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) return this.number();
    for (const [word, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.text.startsWith(word, this.at)) {
        this.at += word.length;
        return value;
      }
    }
    return this.fail("unexpected character");
  }

  private object(depth: number): JsonObject {
    if (depth > MAX_DEPTH) this.fail("nested too deeply");
    this.at++;
    // No prototype: a key named __proto__ is an ordinary key.
    const result: JsonObject = Object.create(null) as JsonObject;
    this.blank();
    if (this.text[this.at] === "}") {
      this.at++;
      return result;
    }
    for (;;) {
      this.blank();
      if (this.text[this.at] !== '"') this.fail("a key must be a string");
      const key = this.string();
      if (Object.hasOwn(result, key)) this.fail("a key is named twice");
      this.blank();
      if (this.text[this.at] !== ":") this.fail("expected a colon");
      this.at++;
      result[key] = this.value(depth);
      this.blank();
      const next = this.text[this.at++];
      if (next === "}") return result;
      if (next !== ",") this.fail("expected a comma or the end of the object");
    }
  }

  private array(depth: number): JsonValue[] {
    if (depth > MAX_DEPTH) this.fail("nested too deeply");
    this.at++;
    const result: JsonValue[] = [];
    this.blank();
    if (this.text[this.at] === "]") {
      this.at++;
      return result;
    }
    for (;;) {
      result.push(this.value(depth));
      this.blank();
      const next = this.text[this.at++];
      if (next === "]") return result;
      if (next !== ",") this.fail("expected a comma or the end of the array");
    }
  }

  private number(): number | JsonFloat {
    NUMBER.lastIndex = this.at;
    const match = NUMBER.exec(this.text);
    if (!match) this.fail("not a number");
    this.at += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail("a number is not finite");
    return match[1] !== undefined || match[2] !== undefined ? new JsonFloat(value) : value;
  }

  private string(): string {
    this.at++;
    let result = "";
    for (;;) {
      const char = this.text[this.at++];
      if (char === undefined) this.fail("a string is not closed");
      if (char === '"') return result;
      if (char < " ") this.fail("a control character in a string");
      if (char !== "\\") {
        result += char;
        continue;
      }
      const escape = this.text[this.at++];
      if (escape === "u") {
        result += this.unicode();
      } else if (escape !== undefined && Object.hasOwn(ESCAPES, escape)) {
        result += ESCAPES[escape];
      } else {
        this.fail("a bad escape");
      }
    }
  }

  /** The character of a `\uXXXX` escape (the `\u` is read): a surrogate pair is one character, and an unpaired
   * surrogate or U+0000 is refused. */
  private unicode(): string {
    const code = this.hex4();
    if (code === 0) this.fail("U+0000 in a string");
    if (code >= 0xdc00 && code <= 0xdfff) this.fail("an unpaired surrogate");
    if (code < 0xd800 || code > 0xdbff) return String.fromCharCode(code);
    if (this.text[this.at] !== "\\" || this.text[this.at + 1] !== "u") this.fail("an unpaired surrogate");
    this.at += 2;
    const low = this.hex4();
    if (low < 0xdc00 || low > 0xdfff) this.fail("an unpaired surrogate");
    return String.fromCharCode(code, low);
  }

  private hex4(): number {
    const digits = this.text.slice(this.at, this.at + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(digits)) this.fail("a bad \\u escape");
    this.at += 4;
    return parseInt(digits, 16);
  }
}

/**
 * The object in `body`, read by the rules of docs/protocol/protocol-v1.md#lines: valid UTF-8, one object and nothing
 * after it, no newline or carriage return, no control character in a string, no comment, no NaN or Infinity, no
 * number that is not finite, no unpaired surrogate escape, no U+0000, no key named twice. Throws JsonError otherwise.
 */
export function parseStrictObject(body: Uint8Array): JsonObject {
  if (body.includes(0x0a) || body.includes(0x0d)) throw new JsonError("a newline or carriage return inside the JSON");
  let text: string;
  try {
    text = decoder.decode(body);
  } catch {
    throw new JsonError("not valid UTF-8");
  }
  return new Reader(text).document();
}
