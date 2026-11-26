// SPDX-License-Identifier: GPL-3.0-or-later

// conformance/client/replies.json: replies both clients must accept or refuse, worked out by hand from the protocol
// specification. tools/test_zenit.py runs the same file through `valid_body`, so the two reply tables cannot drift.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLine } from "../src/protocol/frame";
import { REPLIES, validBody } from "../src/protocol/schema";
import { rawLine } from "./helpers";

interface Case {
  command: string;
  valid: boolean;
  note: string;
  reply: Record<string, unknown>;
}

// JSON.parse with the source text of each number (ES2025), and JSON.rawJSON to write it back as it was: `60.0` stays a
// fraction and 2^53 keeps its digits, so the client's own reader sees the reply exactly as the file writes it.
interface RawJson {
  rawJSON(text: string): unknown;
  parse(text: string, reviver: (key: string, value: unknown, context: { source?: string }) => unknown): unknown;
}
const RAW = JSON as unknown as RawJson;
const file = readFileSync(join(import.meta.dirname, "..", "..", "conformance", "client", "replies.json"), "utf8");
const { cases } = RAW.parse(file, (_key, value, context) =>
  typeof value === "number" && context.source !== undefined ? RAW.rawJSON(context.source) : value,
) as { cases: Case[] };

describe("shared reply cases", () => {
  it("are present", () => {
    expect(cases.length).toBeGreaterThan(50);
  });

  it.each(cases.map((testCase) => [`${testCase.command}: ${testCase.note}`, testCase] as const))(
    "%s",
    (_name, testCase) => {
      const reply = parseLine(rawLine(JSON.stringify(testCase.reply)));
      expect(reply).not.toBeNull();
      expect(validBody(testCase.command, reply!)).toBe(testCase.valid);
    },
  );

  it("have a valid and a refused reply for every command of the reply table", () => {
    for (const command of Object.keys(REPLIES)) {
      const kinds = new Set(cases.filter((testCase) => testCase.command === command).map((testCase) => testCase.valid));
      expect([...kinds].sort(), command).toEqual([false, true]);
    }
  });
});
