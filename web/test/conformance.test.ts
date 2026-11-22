// SPDX-License-Identifier: GPL-3.0-or-later

// The protocol conformance cases (conformance/protocol), read from the client's side. The expected results in them are
// worked out by hand from docs/protocol/protocol-v1.md, so what the board does with a line is known, and the client
// must agree about it: a line the board refuses is a line the client throws away, a request it frames is a line the
// board reads, and a reply the board gives is one the client accepts, with the replies' schema and the settings' limits.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { settingsProblem } from "../src/light/model";
import { Client } from "../src/protocol/client";
import { frameRequest, parseLine } from "../src/protocol/frame";
import { validBody } from "../src/protocol/schema";
import { plain, toInfo, toSettings } from "../src/protocol/types";
import type { JsonObject } from "../src/protocol/strict-json";
import { INFO, ScriptedTransport, lineOf } from "./helpers";

const DIR = join(import.meta.dirname, "..", "..", "conformance", "protocol");

interface Step {
  send?: string | Record<string, unknown>;
  send_hex?: string;
  send_padded?: unknown;
  expect?: Record<string, unknown> | null;
  transport?: string;
  note?: string;
  advance_ms?: number;
  event?: string;
  /** A line for the simulator's control channel (`!token ...`, `!net ...`): not a protocol line, not the client's business. */
  control?: string;
  /** The board closes the WiFi connection after this step's reply. */
  close?: boolean;
}
interface Case {
  description: string;
  transport?: string;
  steps: Step[];
}

const cases: Array<[string, Case]> = readdirSync(DIR)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => [name.replace(/\.json$/, ""), JSON.parse(readFileSync(join(DIR, name), "utf8")) as Case]);

const encoder = new TextEncoder();
/** Cases that test limits only the board has: the board reads 1,024 bytes and 4 levels, the client more. */
const BOARD_ONLY = new Set(["framing_line_limit", "framing_nesting_limit"]);

/**
 * A text that matches a `$pattern` of the cases, which are all of the form `^[class]{n}$` (the token). Anything else would
 * need a generator of its own, and the test says so.
 */
function sampleFor(pattern: string): string {
  const match = /^\^\[a-z0-9\]\{(\d+)\}\$$/.exec(pattern);
  if (!match) throw new Error(`no sample for the pattern ${pattern}`);
  const sample = "abcdefghij0123456789abcdefghij0123456789".slice(0, Number(match[1]));
  expect(new RegExp(pattern).test(sample)).toBe(true);
  return sample;
}

/** `$any` and `$pattern` placeholders as a sample of their type; the firmware version of the case is a plain text. */
function concrete(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(concrete);
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    const any = (value as Record<string, unknown>)["$any"];
    const pattern = (value as Record<string, unknown>)["$pattern"];
    if (entries.length === 1 && typeof any === "string") return { string: "1.0.0", integer: 1, boolean: true }[any];
    if (entries.length === 1 && typeof pattern === "string") return sampleFor(pattern);
    return Object.fromEntries(entries.map(([key, item]) => [key, concrete(item)]));
  }
  return value;
}

/** What the board answers an error with: the code and a message for people, which the cases leave out. */
function replyOf(expectation: Record<string, unknown>): Record<string, unknown> {
  const reply = concrete(expectation) as Record<string, unknown>;
  return reply["ok"] === false ? { ...reply, message: "for people" } : reply;
}

const hex = (digits: string): Uint8Array => Uint8Array.from(digits.match(/../g) ?? [], (pair) => parseInt(pair, 16));

describe("conformance cases", () => {
  it("are present", () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  const info = toInfo({ ...INFO } as unknown as JsonObject);

  describe.each(cases)("%s", (name, testCase) => {
    // The clock, the simulator's events and control lines are for the board; `close` only says how a connection ends
    const steps = testCase.steps.filter(
      (step) => step.advance_ms === undefined && step.event === undefined && step.control === undefined,
    );

    it("throws away the lines the board refuses and reads the ones it answers", () => {
      if (BOARD_ONLY.has(name)) return;
      for (const step of steps) {
        const transport = step.transport ?? testCase.transport ?? "usb";
        let bytes: Uint8Array | null = null;
        if (typeof step.send === "string") bytes = encoder.encode(step.send);
        else if (step.send_hex !== undefined) bytes = hex(step.send_hex);
        if (bytes === null || bytes.includes(0x0a)) continue;
        // The board limits the nesting of a request to 4 levels; replies are read to 64
        if (/nest|level/i.test(step.note ?? "")) continue;
        // Over WebSocket a carriage return at the end stays in the JSON, and a client never gets one from a board
        if (transport === "wifi" && bytes.includes(0x0d)) continue;
        const refused = step.expect === null || (step.expect?.["ok"] === false && step.expect["error"] === "bad_frame");
        const read = parseLine(bytes);
        expect(read === null, `${name}: ${step.note ?? JSON.stringify(step.send)}`).toBe(refused);
      }
    });

    it("frames its requests so that they read back the same", () => {
      for (const step of steps) {
        if (typeof step.send !== "object" || step.send === null) continue;
        expect(plain(parseLine(frameRequest(step.send)) as JsonObject)).toEqual(step.send);
      }
    });

    it("gives replies the client accepts, with settings inside their limits", () => {
      let command = "";
      for (const step of steps) {
        if (typeof step.send === "object" && step.send !== null) command = String(step.send["cmd"]);
        else if (typeof step.send === "string") {
          const read = parseLine(encoder.encode(step.send));
          command = typeof read?.["cmd"] === "string" ? read["cmd"] : "";
        }
        if (!step.expect) continue;
        const reply = replyOf(step.expect);
        const read = parseLine(lineOf(reply));
        expect(read, `${name}: ${step.note ?? ""}`).not.toBeNull();
        if (read === null) continue;
        if (read["ok"] === true && Object.hasOwn(read, "seq"))
          expect(validBody(command, read), `${name}: ${command}`).toBe(true);
        if (read["ok"] === false) expect(validBody(command, read)).toBe(true);
        if (read["ok"] === true && read["settings"] !== undefined) {
          expect(settingsProblem(toSettings(read), info), `${name}: ${command}`).toBeNull();
        }
      }
    });

    it("is answered by the client as the case says", async () => {
      for (const step of steps) {
        const request = step.send;
        if (typeof request !== "object" || request === null || !step.expect) continue;
        const { seq, cmd, ...fields } = request;
        if (typeof seq !== "number" || typeof cmd !== "string" || step.expect["seq"] !== seq) continue;
        const transport = new ScriptedTransport();
        transport.respond = () => [replyOf(step.expect as Record<string, unknown>)];
        const reply = await new Client(transport, { seq }).request(cmd, fields);
        expect(reply).toEqual(JSON.parse(JSON.stringify(replyOf(step.expect))));
      }
    });
  });
});
