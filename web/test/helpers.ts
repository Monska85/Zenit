// SPDX-License-Identifier: GPL-3.0-or-later

import { createHmac } from "node:crypto";
import { crc32, crcHex } from "../src/protocol/crc32";
import { frameRequest, parseLine } from "../src/protocol/frame";
import { ConnectionClosed, type ImprovLink, type LineTransport } from "../src/protocol/transport";
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

/** The board settings of a firmware from the WiFi and updates milestone, with their defaults. */
export const BOARD_SETTINGS = {
  wifi_power: "auto",
  update_mode: "automatic",
  update_firmware: true,
  update_web: true,
  check_hours: 6,
  install_start: 0,
  install_end: 0,
  timezone: "UTC0",
  time_sync_hours: 6,
  ntp_server: "pool.ntp.org",
  network_login: false,
};

export const TOKEN = "abcdefghij012345";
export const NONCE = "00112233445566778899aabbccddeeff";

export const WIFI_STATUS = {
  state: "connected",
  ssid: "HomeNet",
  rssi: -58,
  ip: "192.168.1.20",
  hostname: "zenit-a1b2",
};
export const TIME_STATUS = { synced: true, epoch: 1_800_000_000, local_minute: 600 };
export const UPDATE_STATUS = {
  mode: "automatic",
  state: "idle",
  available: null as string | null,
  last_check: null as number | null,
  last_result: "never",
  progress: null as number | null,
  trial: false,
  skipped: null as string | null,
  rolled_back: null as string | null,
  target: null as "firmware" | "web" | null,
  web: {
    state: "ok",
    version: "1.0.0" as string | null,
    available: null as string | null,
    last_result: "never",
    retry_in: null as number | null,
  },
};

const BOARD_KEYS = Object.keys(BOARD_SETTINGS);

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
  /** What `status` reports besides the light: null leaves the part out, as a board from before the WiFi milestone does. */
  wifi: Record<string, unknown> | null = null;
  time: Record<string, unknown> | null = null;
  update: Record<string, unknown> | null = null;
  token = TOKEN;
  /** The WebSocket close code the board closes the connection with after the reply it just gave, or null. */
  closeCode: number | null = null;
  private authenticated = false;
  private failures = 0;
  private tokens = 0;

  /** The board has WiFi, time and update status and the board settings, as the milestone 4 firmware. */
  withNetwork(): this {
    this.settings = { ...this.settings, ...structuredClone(BOARD_SETTINGS) };
    this.wifi = structuredClone(WIFI_STATUS);
    this.time = structuredClone(TIME_STATUS);
    this.update = structuredClone(UPDATE_STATUS);
    return this;
  }

  /** A new connection: nobody has logged in yet. */
  openConnection(): void {
    this.authenticated = false;
    this.failures = 0;
    this.closeCode = null;
  }

  /** The close the board asked for after its last reply, once. */
  takeClose(): number | null {
    const code = this.closeCode;
    this.closeCode = null;
    return code;
  }

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

  private status(): Record<string, unknown> {
    return {
      light: this.light(),
      ...(this.wifi ? { wifi: this.wifi } : {}),
      ...(this.time ? { time: this.time } : {}),
      ...(this.update ? { update: this.update } : {}),
    };
  }

  /** The settings as `settings_get` reports them: the token only over USB. */
  private shownSettings(kind: "usb" | "websocket"): Record<string, unknown> {
    if (this.settings["network_login"] === undefined) return this.settings;
    return kind === "usb" ? { ...this.settings, token: this.token } : this.settings;
  }

  answer = (request: JsonObject, kind: "usb" | "websocket" = "websocket"): Array<Record<string, unknown>> => {
    this.requests.push(request);
    if (this.silent) return [];
    const seq = request["seq"];
    const cmd = request["cmd"] as string;
    const fail = (error: string): Array<Record<string, unknown>> => [{ seq, ok: false, error, message: "for logs" }];
    const error = this.errors.get(cmd);
    if (error) return fail(error);
    if (
      kind === "websocket" &&
      this.settings["network_login"] === true &&
      !this.authenticated &&
      !["info", "auth_challenge", "auth"].includes(cmd)
    )
      return fail("unauthorized");
    const usbOnly = ["settings_reset", "wifi_forget", "token_regenerate"];
    if (kind === "websocket" && usbOnly.includes(cmd)) return fail("usb_only");
    const { seq: _seq, cmd: _cmd, ...fields } = request;
    void _seq;
    void _cmd;
    switch (cmd) {
      case "info":
        return [{ seq, ok: true, ...this.info }];
      case "status":
        return [{ seq, ok: true, ...this.status() }];
      case "settings_get":
        return [{ seq, ok: true, settings: this.shownSettings(kind) }];
      case "settings_set": {
        if (Object.keys(fields).some((key) => BOARD_KEYS.includes(key) && this.settings[key] === undefined))
          return fail("bad_request");
        this.settings = { ...this.settings, ...fields };
        // The board closes a WiFi connection after the reply that turns network login on
        if (kind === "websocket" && fields["network_login"] === true) this.closeCode = 1000;
        return [{ seq, ok: true, settings: this.shownSettings(kind) }];
      }
      case "light":
        this.on = request["on"] === true;
        return [{ seq, ok: true, light: this.light() }];
      case "settings_reset":
        this.settings = structuredClone(DEFAULT_SETTINGS);
        if (this.wifi) this.settings = { ...this.settings, ...structuredClone(BOARD_SETTINGS) };
        return [{ seq, ok: true, settings: this.shownSettings(kind) }];
      case "wifi_forget":
        if (this.wifi === null) return fail("unknown_command");
        this.wifi = { ...this.wifi, state: "not_configured", ssid: null, rssi: null, ip: null };
        return [{ seq, ok: true }];
      case "token_regenerate":
        this.tokens++;
        this.token = `regenerated${String(this.tokens).padStart(5, "0")}`;
        return [{ seq, ok: true, token: this.token }];
      case "auth_challenge":
        if (this.wifi === null) return fail("unknown_command");
        return [{ seq, ok: true, nonce: NONCE }];
      case "auth": {
        const expected = createHmac("sha256", this.token).update(NONCE).digest("hex");
        if (fields["hmac"] === expected) {
          this.authenticated = true;
          return [{ seq, ok: true }];
        }
        if (++this.failures >= 3) this.closeCode = 1008;
        return fail("unauthorized");
      }
      case "update_check":
      case "update_install": {
        const update = this.update;
        const wifi = this.wifi;
        if (update === null || wifi === null) return fail("unknown_command");
        if (update["mode"] === "off") return fail("updates_off");
        if (wifi["state"] !== "connected") return fail("no_network");
        if (cmd === "update_check") {
          if (update["state"] === "idle") this.update = { ...update, state: "checking", target: "firmware" };
          return [{ seq, ok: true, update: this.update }];
        }
        if (update["state"] !== "idle") return fail("busy");
        if (fields["target"] === "web") {
          if (fields["force"] !== undefined) return fail("bad_request");
          const web = update["web"] as { available: string | null } | undefined;
          if (!web || web.available === null) return fail("nothing_to_install");
          this.update = { ...update, state: "downloading", progress: 0, target: "web" };
          return [{ seq, ok: true, update: this.update }];
        }
        if (update["available"] === null) return fail("nothing_to_install");
        if (update["last_result"] === "skipped" && fields["force"] !== true) return fail("nothing_to_install");
        this.update = { ...update, state: "downloading", progress: 0, target: "firmware" };
        return [{ seq, ok: true, update: this.update }];
      }
      default:
        return fail("unknown_command");
    }
  };

  transport(kind: "usb" | "websocket" = "websocket"): ScriptedTransport {
    const transport = new ScriptedTransport(kind);
    this.openConnection();
    transport.respond = (request) => {
      const replies = this.answer(request, kind);
      const code = this.takeClose();
      // The board closes after its reply: the line goes out first, and the close is a later event, as on a socket
      if (code !== null)
        setTimeout(() => transport.drop(code === 1000 ? undefined : new ConnectionClosed(code, "")), 0);
      return replies;
    };
    return transport;
  }
}

/** An Improv link the test drives: `written` holds the frames the client sent; `receive` plays a frame of the board. */
export class ScriptedImprov implements ImprovLink {
  onFrame: ((type: number, data: Uint8Array) => void) | null = null;
  written: Uint8Array[] = [];
  /** Called with each frame written; may answer by calling `receive`. */
  respond: (frame: Uint8Array) => void = () => undefined;

  sendFrame(frame: Uint8Array): Promise<void> {
    // The client wipes its buffer after sending: keep a copy
    const copy = Uint8Array.from(frame);
    this.written.push(copy);
    queueMicrotask(() => this.respond(copy));
    return Promise.resolve();
  }

  receive(type: number, data: number[] | Uint8Array): void {
    this.onFrame?.(type, Uint8Array.from(data));
  }
}
