// SPDX-License-Identifier: GPL-3.0-or-later

// One connection to a board, and what the app knows of it (docs/web/web-app-v1.md#connection). Plain TypeScript with a
// subscribe function, so the React code only reads it and the tests run it with a scripted board.

import { describeError, NO_ANSWER } from "./messages";
import { settingsProblem } from "../light/model";
import { BoardError, Client, ClientError } from "../protocol/client";
import type { LineTransport } from "../protocol/transport";
import { toLight, toSettings, type BoardInfo, type LightStatus, type Settings } from "../protocol/types";

export type Phase = "disconnected" | "connecting" | "connected" | "lost";
export type Kind = "usb" | "websocket";

export interface BoardState {
  phase: Phase;
  kind: Kind | null;
  /** "USB" or the address typed, for the connection chip. */
  label: string;
  info: BoardInfo | null;
  settings: Settings | null;
  light: LightStatus | null;
  /** A sentence for the banner, until it is closed or the next request succeeds. */
  error: string | null;
  /** A connection is being opened (a port chosen, a socket connecting): no other one may start. */
  opening: boolean;
}

/** A connection that could not be opened; the message is the sentence for the banner. */
export class OpenFailed extends Error {}

/** What opens a connection: a transport, null when the person gave up (a closed chooser), or an OpenFailed. */
export type Opener = () => Promise<LineTransport | null>;

export const POLL_MS = 1000;

const INITIAL: BoardState = {
  phase: "disconnected",
  kind: null,
  label: "",
  info: null,
  settings: null,
  light: null,
  error: null,
  opening: false,
};

/** The page's visibility, so polling can pause while it is hidden. Missing in Node. */
export interface Visibility {
  hidden(): boolean;
  /** Calls `listener` when the page is shown again; returns what stops it. */
  onShown(listener: () => void): () => void;
}

export class BoardSession {
  private state: BoardState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private client: Client | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopShown: (() => void) | null = null;
  /** Bumped by every connection and disconnection, so late results of an old connection are dropped. */
  private generation = 0;
  /** How the last connection was opened, so a lost one can be opened again the same way. */
  private reopener: { opener: Opener; label: string } | null = null;

  constructor(private readonly visibility: Visibility | null = null) {}

  getState = (): BoardState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<BoardState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Connects over a transport that is already open: `info` first, then the settings and the light. */
  async connect(
    transport: LineTransport,
    label: string,
    reopener: { opener: Opener; label: string } | null = null,
  ): Promise<void> {
    await this.disconnect();
    const generation = ++this.generation;
    this.update({ ...INITIAL, phase: "connecting", kind: transport.kind, label });
    const client = new Client(transport);
    this.client = client;
    try {
      const info = await client.handshake();
      const settings = toSettings(await client.call("settings_get"));
      const problem = settingsProblem(settings, info);
      if (problem) throw new ClientError("protocol", problem);
      const light = toLight(await client.call("status"));
      if (generation !== this.generation) return;
      this.update({ phase: "connected", info, settings, light, error: null });
      // Only a connection that completed its handshake becomes the one Reconnect opens again
      if (reopener) this.reopener = reopener;
      this.startPolling(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.client = null;
      await client.close().catch(() => undefined);
      this.update({ ...INITIAL, error: describeError(error) });
    }
  }

  /**
   * Opens a connection and connects over it. A second call while one is opening, or connecting, is ignored. A failed or
   * cancelled open changes nothing but the banner: a live connection, and the board's one slot it holds, stay as they are.
   */
  async open(opener: Opener, label: string): Promise<void> {
    if (this.state.opening || this.state.phase === "connecting") return;
    this.update({ opening: true });
    let transport: LineTransport | null;
    try {
      transport = await opener();
    } catch (error) {
      this.update({ opening: false, error: error instanceof OpenFailed ? error.message : describeError(error) });
      return;
    }
    if (transport === null) {
      this.update({ opening: false });
      return;
    }
    await this.connect(transport, label, { opener, label });
  }

  /** Opens the connection that was lost the same way: the same address, or the same port when it is still there. */
  async reconnect(): Promise<void> {
    if (this.reopener) await this.open(this.reopener.opener, this.reopener.label);
  }

  /** Closes the connection. False when the port could not be released: the cable must be unplugged and plugged in. */
  async disconnect(): Promise<boolean> {
    this.generation++;
    this.stopPolling();
    const client = this.client;
    this.client = null;
    let released = true;
    if (client) await client.close().catch(() => (released = false));
    if (this.state.phase !== "disconnected") this.update({ ...INITIAL, opening: this.state.opening });
    return released;
  }

  dismissError(): void {
    this.update({ error: null });
  }

  /** `settings_set` with the settings the user chose; the board's reply is what is shown afterwards. */
  async setSettings(patch: Partial<Settings>): Promise<void> {
    await this.run(async (client, info) => {
      try {
        const settings = toSettings(await client.call("settings_set", patch));
        const problem = settingsProblem(settings, info);
        if (problem) throw new ClientError("protocol", problem);
        this.show(client, { settings, error: null });
      } catch (error) {
        // Show what the board holds, not what the user tried
        if (error instanceof BoardError && this.client === client) await this.refreshSettings(client, info);
        throw error;
      }
    });
  }

  /** `light`: on or off, not saved. */
  async setPower(on: boolean): Promise<void> {
    await this.run(async (client) => {
      this.show(client, { light: toLight(await client.call("light", { on })), error: null });
    });
  }

  /** `settings_reset`, USB only: every setting back to its default. */
  async resetSettings(): Promise<void> {
    await this.run(async (client, info) => {
      const settings = toSettings(await client.call("settings_reset"));
      const problem = settingsProblem(settings, info);
      if (problem) throw new ClientError("protocol", problem);
      this.show(client, { settings, light: toLight(await client.call("status")), error: null });
    });
  }

  /** Shows what a request learned, unless its connection has been closed or replaced meanwhile: a late reply of an old
   * connection must not touch the state of the new one. */
  private show(client: Client, patch: Partial<BoardState>): void {
    if (this.client === client) this.update(patch);
  }

  private async refreshSettings(client: Client, info: BoardInfo): Promise<void> {
    try {
      const settings = toSettings(await client.call("settings_get"));
      if (settingsProblem(settings, info) === null) this.show(client, { settings });
    } catch {
      // the error being reported is the one that matters
    }
  }

  /** Runs a request for the user: its failure is shown, and a board that stops answering is lost. */
  private async run(request: (client: Client, info: BoardInfo) => Promise<void>): Promise<void> {
    const client = this.client;
    const info = this.state.info;
    if (!client || !info || this.state.phase !== "connected") return;
    try {
      await request(client, info);
    } catch (error) {
      if (this.client !== client) return;
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (error instanceof ClientError && (error.failure === "no_reply" || error.failure === "closed")) {
      this.lose();
    } else {
      this.update({ error: describeError(error) });
    }
  }

  private lose(): void {
    this.stopPolling();
    const client = this.client;
    this.client = null;
    void client?.close().catch(() => undefined);
    this.update({ phase: "lost", error: NO_ANSWER });
  }

  private startPolling(generation: number): void {
    this.stopPolling();
    const poll = async (): Promise<void> => {
      const client = this.client;
      if (!client || generation !== this.generation || client.busy || this.visibility?.hidden()) return;
      try {
        const light = toLight(await client.call("status"));
        if (generation === this.generation) this.update({ light });
      } catch (error) {
        if (generation !== this.generation) return;
        // A refused status is not worth a banner every second; a board that is gone is lost
        if (error instanceof ClientError) this.fail(error);
      }
    };
    this.timer = setInterval(() => void poll(), POLL_MS);
    this.stopShown = this.visibility?.onShown(() => void poll()) ?? null;
  }

  private stopPolling(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stopShown?.();
    this.stopShown = null;
  }
}
