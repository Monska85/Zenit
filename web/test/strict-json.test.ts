// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { JsonError, JsonFloat, MAX_DEPTH, parseStrictObject } from "../src/protocol/strict-json";
import { text } from "./helpers";

const parse = (source: string) => parseStrictObject(text(source));

describe("parseStrictObject accepts", () => {
  it("an object of every JSON type", () => {
    expect(parse('{"a":1,"b":"x","c":true,"d":false,"e":null,"f":[1,2],"g":{"h":-3}}')).toEqual({
      a: 1,
      b: "x",
      c: true,
      d: false,
      e: null,
      f: [1, 2],
      g: { h: -3 },
    });
  });

  it("spaces and tabs between tokens, and around the object", () => {
    expect(parse(' \t{ "a" :\t1 , "b" : [ 1 , 2 ] } ')).toEqual({ a: 1, b: [1, 2] });
  });

  it("an empty object and empty containers", () => {
    expect(parse("{}")).toEqual({});
    expect(parse('{"a":[],"b":{}}')).toEqual({ a: [], b: {} });
  });

  it("escapes, including a surrogate pair", () => {
    expect(parse('{"a":"\\" \\\\ \\/ \\b \\f \\n \\r \\t \\u00e9 \\ud83d\\ude00"}')["a"]).toBe(
      '" \\ / \b \f \n \r \t é 😀',
    );
  });

  it("non-ASCII text as UTF-8", () => {
    expect(parse('{"a":"é😀"}')["a"]).toBe("é😀");
  });

  it("a key named __proto__ as an ordinary key", () => {
    const value = parse('{"__proto__":1}');
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(value["__proto__"]).toBe(1);
    expect(Object.getPrototypeOf(value)).toBeNull();
  });

  it("the same key in different objects", () => {
    expect(parse('{"a":{"b":1},"c":{"b":2}}')).toEqual({ a: { b: 1 }, c: { b: 2 } });
  });

  it("nesting up to the limit", () => {
    expect(() => parse('{"a":' + "[".repeat(MAX_DEPTH - 1) + "]".repeat(MAX_DEPTH - 1) + "}")).not.toThrow();
  });
});

describe("numbers", () => {
  it("integers are numbers, and numbers with a fraction or exponent are floats", () => {
    const value = parse('{"i":60,"n":-0,"f":60.0,"e":6e1,"g":1.5}');
    expect(value["i"]).toBe(60);
    expect(value["f"]).toBeInstanceOf(JsonFloat);
    expect((value["f"] as JsonFloat).value).toBe(60);
    expect(value["e"]).toBeInstanceOf(JsonFloat);
    expect((value["g"] as JsonFloat).value).toBe(1.5);
    expect(Object.is(value["n"], -0)).toBe(true);
  });

  it.each(["01", "+1", "1.", ".5", "1e", "0x10", "--1", "1e+", "-"])("refuses %s", (number) => {
    expect(() => parse(`{"a":${number}}`)).toThrow(JsonError);
  });

  it.each(["NaN", "Infinity", "-Infinity", "1e999", "-1e999"])("refuses %s", (number) => {
    expect(() => parse(`{"a":${number}}`)).toThrow(JsonError);
  });
});

describe("parseStrictObject refuses", () => {
  const bad: Array<[string, string]> = [
    ["a comment", '{"a":1} // c'],
    ["a block comment", '{"a":1,/* c */"b":2}'],
    ["single quotes", "{'a':1}"],
    ["an unquoted key", "{a:1}"],
    ["a trailing comma", '{"a":1,}'],
    ["a leading comma", '{,"a":1}'],
    ["a trailing comma in an array", '{"a":[1,]}'],
    ["a missing comma", '{"a":1 "b":2}'],
    ["a missing colon", '{"a" 1}'],
    ["text after the object", '{"a":1} x'],
    ["a second object", '{"a":1}{"b":2}'],
    ["an array at the top", "[1]"],
    ["a string at the top", '"x"'],
    ["nothing", ""],
    ["an unclosed object", '{"a":1'],
    ["an unclosed string", '{"a":"x}'],
    ["a raw tab in a string", '{"a":"x\ty"}'],
    ["a raw control character in a string", '{"a":"x\u0001y"}'],
    ["an escaped U+0000", '{"a":"x\\u0000y"}'],
    ["an unpaired high surrogate", '{"a":"\\ud800"}'],
    ["an unpaired low surrogate", '{"a":"\\udc00"}'],
    ["a high surrogate followed by a plain escape", '{"a":"\\ud800\\u0041"}'],
    ["a high surrogate followed by text", '{"a":"\\ud800x"}'],
    ["a bad escape", '{"a":"\\x"}'],
    ["a short unicode escape", '{"a":"\\u12"}'],
    ["a key named twice", '{"a":1,"a":2}'],
    ["a key named twice after decoding", '{"a":1,"\\u0061":2}'],
    ["a key named twice in a nested object", '{"x":{"a":1,"a":2}}'],
    ["a key named twice inside an array", '{"x":[{"a":1,"a":2}]}'],
    ["a non-string key", "{1:1}"],
    ["a byte order mark", "﻿{}"],
    ["a word that is not JSON", '{"a":undefined}'],
  ];
  it.each(bad)("%s", (_name, source) => {
    expect(() => parse(source)).toThrow(JsonError);
  });

  it("a newline or carriage return anywhere", () => {
    for (const source of ['{"a":1}\n', '{"a":\n1}', '{"a":1}\r', '{"a":"x\ry"}', '{\r"a":1}']) {
      expect(() => parse(source)).toThrow(JsonError);
    }
  });

  it("invalid UTF-8", () => {
    expect(() => parseStrictObject(Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]))).toThrow(JsonError);
    expect(() => parseStrictObject(Uint8Array.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x31, 0x7d]))).toThrow(
      JsonError,
    );
    // an encoded surrogate
    expect(() => parseStrictObject(Uint8Array.from([0x7b, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x3a, 0x31, 0x7d]))).toThrow(
      JsonError,
    );
  });

  it("a raw NUL byte", () => {
    expect(() => parseStrictObject(Uint8Array.from([0x7b, 0x22, 0x00, 0x22, 0x3a, 0x31, 0x7d]))).toThrow(JsonError);
  });

  it("nesting beyond the limit, without running out of stack", () => {
    expect(() => parse('{"a":' + "[".repeat(MAX_DEPTH + 1) + "]".repeat(MAX_DEPTH + 1) + "}")).toThrow(JsonError);
    expect(() => parse('{"a":' + "[".repeat(100000))).toThrow(JsonError);
  });
});
