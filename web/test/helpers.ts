// SPDX-License-Identifier: GPL-3.0-or-later

import { crc32, crcHex } from "../src/protocol/crc32";
import { frameRequest, parseLine } from "../src/protocol/frame";
import type { LineTransport } from "../src/protocol/transport";
import type { JsonObject } from "../src/protocol/strict-json";

export const text = (value: string): Uint8Array => new TextEncoder().encode(value);

/** A reply or request as the line a board writes (same framing both ways), without the newline. */
export const lineOf = (value: Record<string, unknown>): Uint8Array => frameRequest(value);

/** A line with a correct checksum for JSON text written by hand. */
export const rawLine = (json: string): Uint8Array => {
  const body = text(json);
  return new Uint8Array([...text(`@ZN ${crcHex(crc32(body))} `), ...body]);
};

export const INFO = {
  protocol: 1,
  firmware: "1.2.3",
  board: "simulator",
  boot_id: 4242,
  colors: ["white", "red", "green", "blue"],
  effects: ["static", "color_change", "breathing", "twinkle", "fall_asleep", "christmas"],
  color_sets: ["christmas", "ice"],
  power_limit_mw: 1000,
  memory: { free: 0, largest: 0 },
  nvs: { used: 0, free: 0 },
  limits: { line: 1024 },
};

export const DEFAULT_SETTINGS = {
  brightness: 60,
  effect: "static",
  color: "white",
  colors: ["red", "green", "blue", "white"],
  color_set: "christmas",
  hold_seconds: 30,
  period_seconds: 8,
  floor: 20,
  twinkle_strength: 20,
  timer_minutes: 0,
};

/** A transport the test drives: what the client wrote is in `written`; `receive` plays a line from the board. */
export class ScriptedTransport implements LineTransport {
  kind: "usb" | "websocket" = "websocket";
  onLine: ((line: Uint8Array) => void) | null = null;
  onClose: ((cause?: Error) => void) | null = null;
  written: Uint8Array[] = [];
  closed = false;
  /** Called with each request the client writes, as an object; returns the lines to answer with. */
  respond: (request: JsonObject, write: Uint8Array) => Array<Record<string, unknown> | Uint8Array> = () => [];

  constructor(kind: "usb" | "websocket" = "websocket") {
    this.kind = kind;
  }

  async send(line: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("closed");
    this.written.push(line);
    const request = parseLine(line);
    if (!request) return;
    for (const answer of this.respond(request, line)) {
      this.receive(answer instanceof Uint8Array ? answer : lineOf(answer));
    }
  }

  receive(line: Uint8Array): void {
    this.onLine?.(line);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.();
  }

  /** The connection ends from the other side. */
  drop(cause?: Error): void {
    this.closed = true;
    this.onClose?.(cause);
  }
}

/** A board that answers like the simulator: settings that change, a light that turns on and off. */
export class FakeBoard {
  info: Record<string, unknown> = structuredClone(INFO);
  settings: Record<string, unknown> = structuredClone(DEFAULT_SETTINGS);
  on = true;
  requests: JsonObject[] = [];
  /** Commands to answer with an error instead, by name. */
  errors = new Map<string, string>();
  silent = false;

  light(): Record<string, unknown> {
    const minutes = this.settings["timer_minutes"] as number;
    return {
      on: this.on,
      effect: this.settings["effect"],
      color: this.on ? this.settings["color"] : null,
      lightness: this.on ? 60.0 : 0.0,
      power_scale: 100,
      timer: minutes === 0 ? null : { minutes, remaining: minutes * 60 },
    };
  }

  answer = (request: JsonObject): Array<Record<string, unknown>> => {
    this.requests.push(request);
    if (this.silent) return [];
    const seq = request["seq"];
    const cmd = request["cmd"] as string;
    const error = this.errors.get(cmd);
    if (error) return [{ seq, ok: false, error, message: "for logs" }];
    switch (cmd) {
      case "info":
        return [{ seq, ok: true, ...this.info }];
      case "status":
        return [{ seq, ok: true, light: this.light() }];
      case "settings_get":
        return [{ seq, ok: true, settings: this.settings }];
      case "settings_set": {
        const { seq: _seq, cmd: _cmd, ...patch } = request;
        void _seq;
        void _cmd;
        this.settings = { ...this.settings, ...patch };
        return [{ seq, ok: true, settings: this.settings }];
      }
      case "light":
        this.on = request["on"] === true;
        return [{ seq, ok: true, light: this.light() }];
      case "settings_reset":
        this.settings = structuredClone(DEFAULT_SETTINGS);
        return [{ seq, ok: true, settings: this.settings }];
      default:
        return [{ seq, ok: false, error: "unknown_command", message: "no" }];
    }
  };

  transport(kind: "usb" | "websocket" = "websocket"): ScriptedTransport {
    const transport = new ScriptedTransport(kind);
    transport.respond = this.answer;
    return transport;
  }
}
