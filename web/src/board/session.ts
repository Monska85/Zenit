// SPDX-License-Identifier: GPL-3.0-or-later

// One connection to a board, and what the app knows of it (docs/web/web-app-v1.md#connection). Plain TypeScript with a
// subscribe function, so the React code only reads it and the tests run it with a scripted board.

import { message, type Message } from "../i18n";
import { errorMessage, NO_ANSWER } from "./messages";
import type { ServedBoard } from "./served";
import { settingsProblem } from "../light/model";
import { isToken, login } from "../protocol/auth";
import { BoardError, Client, ClientError } from "../protocol/client";
import type { ImprovLink, LineTransport } from "../protocol/transport";
import {
  toFavorites,
  toLight,
  toSettings,
  toStatus,
  toUpdate,
  type BoardInfo,
  type BoardStatus,
  type Favorite,
  type FavoriteList,
  type LightStatus,
  type Settings,
  type TimeStatus,
  type UpdateStatus,
  type WifiStatus,
} from "../protocol/types";

/** `login`: the connection is open and the board wants the access token before it answers anything else. */
export type Phase = "disconnected" | "connecting" | "login" | "connected" | "lost";
export type Kind = "usb" | "websocket";

export interface BoardState {
  phase: Phase;
  kind: Kind | null;
  /** "USB" or the address typed, for the connection chip. */
  label: string;
  info: BoardInfo | null;
  settings: Settings | null;
  light: LightStatus | null;
  /** The favorites in the board's order; null until they are read, and on a board that reports no favorites limits. */
  favorites: Favorite[] | null;
  /** The id of the favorite Zenit turns on with, or null. */
  start: number | null;
  /** From the WiFi and updates milestone; null from a board that does not report them. */
  wifi: WifiStatus | null;
  time: TimeStatus | null;
  update: UpdateStatus | null;
  /** A sentence for the banner, until it is closed or the next request succeeds. */
  error: Message | null;
  /** A connection is being opened (a port chosen, a socket connecting): no other one may start. */
  opening: boolean;
  /** Why the token was not accepted, while the phase is `login`. */
  loginProblem: Message | null;
  /** While the phase is `login`: the board closed the connection for waiting too long, and the next try opens it again. */
  loginIdle: boolean;
  /** The board that served this page, when there is one. */
  served: ServedBoard | null;
  /** The page is asking its own origin whether a board served it. */
  probing: boolean;
  /**
   * A lost connection that is being opened again by itself: `restarting` while a firmware install restarts the board,
   * `reconnecting` after the board closed the connection on purpose.
   */
  auto: "restarting" | "reconnecting" | null;
}

/** The board's name as it reports it: the board that served the page, or the name it has on the network. */
export const boardName = (board: BoardState): string | null => board.served?.hostname ?? board.wifi?.hostname ?? null;

/** A connection that could not be opened; `reason` is the sentence for the banner. */
export class OpenFailed extends Error {
  constructor(readonly reason: Message) {
    super(reason.key);
  }
}

/**
 * What opens a connection: a transport, null when the person gave up (a closed chooser), or an OpenFailed.
 * `interactive` is false for a try the page makes by itself, which may not ask the person anything.
 */
export type Opener = (interactive: boolean) => Promise<LineTransport | null>;

/**
 * What a favorites request came to. `code` is the board's error code when it refused. For a request made from a dialog
 * the refusal is not put in the session's `error` (the bottom message sits behind the dialog): `message` is its sentence,
 * for the dialog to show, and `nameProblem` says it is about the name, which the dialog shows next to its field.
 */
export interface FavoriteOutcome {
  ok: boolean;
  code: string | null;
  nameProblem: boolean;
  message: Message | null;
}

const NAME_ERRORS: readonly string[] = ["bad_name", "name_taken"];

/** Where the sentence of a refused favorites request goes: the bottom message, or the dialog the request came from. */
type ErrorPlace = "page" | "dialog";

export const POLL_MS = 1000;
/** The wait between the tries to open a lost connection again by itself, and how many tries: about a minute. */
const RETRY_MS = 3000;
export const RETRY_ATTEMPTS = 20;

const INITIAL: BoardState = {
  phase: "disconnected",
  kind: null,
  label: "",
  info: null,
  settings: null,
  light: null,
  favorites: null,
  start: null,
  wifi: null,
  time: null,
  update: null,
  error: null,
  opening: false,
  loginProblem: null,
  loginIdle: false,
  served: null,
  probing: false,
  auto: null,
};

/** Update states in which a lost connection means the board is restarting. */
const RESTARTING_STATES = ["downloading", "verifying", "restarting"];

const isUnauthorized = (error: unknown): boolean => error instanceof BoardError && error.code === "unauthorized";

const listPatch = (list: FavoriteList): Partial<BoardState> => ({ favorites: list.favorites, start: list.start });

const statusPatch = (status: BoardStatus): Partial<BoardState> => ({
  light: status.light,
  wifi: status.wifi,
  time: status.time,
  update: status.update,
});

export interface SessionOptions {
  /** The wait between the tries to reconnect by itself; short in tests. */
  retryMs?: number;
  retryAttempts?: number;
  /** Loads the page again: the board installed a new web app (close status 1012). The browser's by default. */
  reload?: () => void;
}

/** The close status of a board that installed a new web app: the page it served loads again to get it. */
const CLOSE_RELOAD = 1012;

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
  /** The access token, in memory only: it is never stored, and a page reload forgets it. */
  private token: string | null = null;
  /** The request that was refused as `unauthorized`, to run again once the login succeeds. */
  private pendingRetry: (() => Promise<void>) | null = null;
  /** The board is about to close the connection on purpose (network login turned on): open it again by itself. */
  private expectDrop = false;
  /** The tokens the board refused on this connection: three close it with 1008, the same status as an idle one. */
  private refusedTokens = 0;
  /** Bumped by every disconnection and every new automatic reconnection, so an older one stops. */
  private retryRun = 0;
  /** An `open()` is running: `state.opening` shows it, and no second one may start. */
  private openRunning = false;
  private readonly retryMs: number;
  private readonly retryAttempts: number;
  private readonly reload: () => void;

  constructor(
    private readonly visibility: Visibility | null = null,
    options: SessionOptions = {},
  ) {
    this.retryMs = options.retryMs ?? RETRY_MS;
    this.retryAttempts = options.retryAttempts ?? RETRY_ATTEMPTS;
    this.reload = options.reload ?? (() => globalThis.location?.reload());
  }

  getState = (): BoardState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<BoardState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** The phase now: a check after an await must not be narrowed by one made before it. */
  private phase(): Phase {
    return this.state.phase;
  }

  /** The state of no connection: what the page knows about the board that served it stays. */
  private blank(patch: Partial<BoardState> = {}): Partial<BoardState> {
    return { ...INITIAL, served: this.state.served, probing: this.state.probing, ...patch };
  }

  /** The page starts looking for the board that served it. */
  beginProbe(): void {
    this.update({ probing: true });
  }

  /** The page knows whether a board served it. */
  setServed(served: ServedBoard | null): void {
    this.update({ served, probing: false });
  }

  /** The Improv side of the open connection (USB serial), or null. */
  improvLink(): ImprovLink | null {
    return this.client?.improv ?? null;
  }

  /**
   * Connects over a transport that is already open: `info` first, then the settings and the light. With `silent`, a
   * connection that cannot be completed leaves the state as it was (a lost connection stays lost) and shows no error.
   */
  async connect(
    transport: LineTransport,
    label: string,
    reopener: { opener: Opener; label: string } | null = null,
    silent = false,
  ): Promise<void> {
    // A silent try is made by the page for a lost connection: it stays on screen as it was until the board answers
    this.refusedTokens = 0;
    if (silent) this.generation++;
    else {
      await this.teardown();
      this.generation++;
      this.update(this.blank({ phase: "connecting", kind: transport.kind, label, opening: this.openRunning }));
    }
    const generation = this.generation;
    const client = new Client(transport);
    this.client = client;
    client.onEnd = (error) => this.ended(client, error);
    try {
      const info = await client.handshake();
      if (generation !== this.generation) return;
      this.update({ info });
      // Only a connection that completed its handshake becomes the one Reconnect opens again
      if (reopener) this.reopener = reopener;
      await this.complete(client, info, generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.client = null;
      await client.close().catch(() => undefined);
      if (!silent) this.update(this.blank({ opening: this.openRunning, error: errorMessage(error) }));
    }
  }

  /**
   * The rest of the handshake: the settings and the status. A board that wants a login first answers `unauthorized`: the
   * stored token is tried, and when there is none, or it is refused, the phase is `login` until `submitToken` succeeds.
   */
  private async complete(client: Client, info: BoardInfo, generation: number, retried = false): Promise<void> {
    try {
      const settings = toSettings(await client.call("settings_get"));
      const problem = settingsProblem(settings, info);
      if (problem) throw new ClientError("invalid_reply", problem);
      // The favorites come before the Light view shows, so its card never has a loading state of its own
      const list = info.limits.favorites === undefined ? null : toFavorites(await client.call("favorites"));
      const status = toStatus(await client.call("status"));
      if (generation !== this.generation) return;
      if (settings.token !== undefined) this.token = settings.token;
      this.update({
        phase: "connected",
        settings,
        ...(list ? listPatch(list) : {}),
        ...statusPatch(status),
        error: null,
        loginProblem: null,
        loginIdle: false,
        auto: null,
      });
      this.startPolling(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      if (!isUnauthorized(error) || client.kind !== "websocket") throw error;
      // A board that accepts the login and still refuses gets one more try, not a loop
      if (!retried && this.token !== null && (await this.tryLogin(client, this.token))) {
        if (generation === this.generation) await this.complete(client, info, generation, true);
        return;
      }
      if (generation !== this.generation) return;
      this.stopPolling();
      this.update({ phase: "login", loginProblem: null, loginIdle: false, auto: null });
    }
  }

  /** Runs the login with `token`: true when the board accepted it, false when it refused. Other failures throw. */
  private async tryLogin(client: Client, token: string): Promise<boolean> {
    try {
      await login(client, token);
      return true;
    } catch (error) {
      if (isUnauthorized(error)) {
        this.refusedTokens++;
        return false;
      }
      throw error;
    }
  }

  /**
   * Opens a connection and connects over it. A second call while one is opening, or connecting, is ignored. A failed or
   * cancelled open changes nothing but the banner: a live connection, and the board's one slot it holds, stay as they are.
   */
  async open(opener: Opener, label: string, silent = false): Promise<void> {
    if (this.openRunning || this.state.phase === "connecting") return;
    this.openRunning = true;
    this.update({ opening: true });
    try {
      let transport: LineTransport | null;
      try {
        transport = await opener(!silent);
      } catch (error) {
        const reason = error instanceof OpenFailed ? error.reason : errorMessage(error);
        if (!silent) this.update({ error: reason });
        return;
      }
      if (transport !== null) await this.connect(transport, label, { opener, label }, silent);
    } finally {
      // Whatever path the open took, silent or not, it is over: Connect and Reconnect work again
      this.openRunning = false;
      if (this.state.opening) this.update({ opening: false });
    }
  }

  /** Opens the connection that was lost the same way: the same address, or the same port when it is still there. */
  async reconnect(silent = false): Promise<void> {
    if (!silent) this.retryRun++;
    if (this.reopener) await this.open(this.reopener.opener, this.reopener.label, silent);
  }

  /** Closes the connection. False when the port could not be released: the cable must be unplugged and plugged in. */
  async disconnect(): Promise<boolean> {
    this.retryRun++;
    this.expectDrop = false;
    this.pendingRetry = null;
    return this.teardown();
  }

  /** Closes the connection and forgets what it knew; automatic reconnection is left as it is. */
  private async teardown(): Promise<boolean> {
    this.generation++;
    this.stopPolling();
    const client = this.client;
    this.client = null;
    let released = true;
    if (client) await client.close().catch(() => (released = false));
    if (this.state.phase !== "disconnected" || this.state.auto !== null)
      this.update(this.blank({ opening: this.openRunning }));
    return released;
  }

  /** A sentence for the bottom message, for a caller that has a refusal to show and no dialog left to show it in. */
  showError(text: Message): void {
    this.update({ error: text });
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
        if (problem) throw new ClientError("invalid_reply", problem);
        // The board closes a WiFi connection after the reply that turns network login on: it opens again by itself
        if (patch.network_login === true && settings.network_login === true && client.kind === "websocket")
          this.expectDrop = true;
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
    await this.run(async (client, info) => {
      this.show(client, { light: toLight(await client.call("light", { on })), error: null });
      // A turn-on with a favorite marked shows that favorite's look: the board applied it, so read the settings
      if (on && this.state.start !== null) await this.refreshSettings(client, info);
    });
  }

  /** `favorite_apply`: the whole look and the light on, in one request; the reply holds the light and the settings. */
  applyFavorite(id: number): Promise<FavoriteOutcome> {
    return this.favoriteRequest("page", async (client, info) => {
      const reply = await client.call("favorite_apply", { id });
      const settings = toSettings(reply);
      const problem = settingsProblem(settings, info);
      if (problem) throw new ClientError("invalid_reply", problem);
      this.show(client, { light: toLight(reply), settings, error: null });
    });
  }

  /** `favorite_save` of the light as it is now, as a new favorite called `name`. */
  saveFavorite(name: string): Promise<FavoriteOutcome> {
    return this.favoriteList("favorite_save", { name });
  }

  /** `favorite_save` over an existing favorite: its look becomes the light as it is now; its name and mark stay. */
  replaceFavorite(id: number): Promise<FavoriteOutcome> {
    return this.favoriteList("favorite_save", { id });
  }

  renameFavorite(id: number, name: string): Promise<FavoriteOutcome> {
    return this.favoriteList("favorite_rename", { id, name });
  }

  deleteFavorite(id: number): Promise<FavoriteOutcome> {
    return this.favoriteList("favorite_delete", { id });
  }

  /** `favorite_start`: the favorite Zenit turns on with, or null for the last light. */
  setStartFavorite(id: number | null): Promise<FavoriteOutcome> {
    return this.favoriteList("favorite_start", { id });
  }

  /** A favorites command whose reply is the whole list. */
  private favoriteList(cmd: string, fields: Record<string, string | number | null>): Promise<FavoriteOutcome> {
    return this.favoriteRequest("dialog", async (client) => {
      this.show(client, { ...listPatch(toFavorites(await client.call(cmd, fields))), error: null });
    });
  }

  /**
   * Runs a favorites request. When the board refuses it the list is read again, so what is shown is what the board
   * holds. `place` says where the sentence goes: the bottom message, or the outcome for the dialog that asked.
   */
  private async favoriteRequest(
    place: ErrorPlace,
    request: (client: Client, info: BoardInfo) => Promise<void>,
  ): Promise<FavoriteOutcome> {
    let code: string | null = null;
    let message: Message | null = null;
    let attempts = 0;
    const ran = await this.run(async (client, info) => {
      // A run after a login is the retry `run` makes once the outcome was already returned, and the login screen has
      // closed every dialog: its refusal goes to the bottom message, which nothing covers then
      const where: ErrorPlace = attempts++ === 0 ? place : "page";
      try {
        await request(client, info);
      } catch (error) {
        // A login is not a refusal of this request: `run` asks for it and runs the request again
        if (error instanceof BoardError && this.client === client && !isUnauthorized(error)) {
          code = error.code;
          await this.refreshFavorites(client);
          if (where === "dialog") {
            message = errorMessage(error);
            return;
          }
        }
        throw error;
      }
    });
    return { ok: ran && code === null, code, nameProblem: code !== null && NAME_ERRORS.includes(code), message };
  }

  private async refreshFavorites(client: Client): Promise<void> {
    try {
      this.show(client, listPatch(toFavorites(await client.call("favorites"))));
    } catch {
      // the error being reported is the one that matters
    }
  }

  /** `settings_reset`, USB only: every setting back to its default. */
  async resetSettings(): Promise<void> {
    await this.run(async (client, info) => {
      const favorites = info.limits.favorites !== undefined;
      let settings: Settings;
      try {
        settings = toSettings(await client.call("settings_reset"));
      } catch (error) {
        // `storage_error` may come after the settings were reset, when only the favorites could not be written: show
        // what the board holds, and keep the error
        if (error instanceof BoardError && this.client === client) {
          await this.refreshSettings(client, info);
          if (favorites) await this.refreshFavorites(client);
          await this.refreshLight(client);
        }
        throw error;
      }
      const problem = settingsProblem(settings, info);
      if (problem) throw new ClientError("invalid_reply", problem);
      // A reset brings back the ready-made favorites, with none marked to turn on with
      const list = favorites ? toFavorites(await client.call("favorites")) : null;
      this.show(client, {
        settings,
        ...(list ? listPatch(list) : {}),
        ...statusPatch(toStatus(await client.call("status"))),
        error: null,
      });
    });
  }

  /** Asks `status` now, for what the person just did to show at once (the poll comes once a second). */
  async refreshStatus(): Promise<void> {
    await this.run(async (client) => {
      this.show(client, statusPatch(toStatus(await client.call("status"))));
    });
  }

  /** `wifi_forget`, USB only: the board forgets its WiFi network. */
  async forgetWifi(): Promise<void> {
    await this.run(async (client) => {
      await client.call("wifi_forget");
      this.show(client, { ...statusPatch(toStatus(await client.call("status"))), error: null });
    });
  }

  /** `token_regenerate`, USB only: a new token; every WiFi client has to log in again. */
  async regenerateToken(): Promise<void> {
    await this.run(async (client) => {
      const token = (await client.call("token_regenerate"))["token"];
      if (typeof token !== "string" || !isToken(token))
        throw new ClientError("invalid_reply", "the token is not valid");
      this.token = token;
      const settings = this.state.settings;
      this.show(client, { settings: settings ? { ...settings, token } : settings, error: null });
    });
  }

  /** `update_check`: the board looks for new firmware in the background; the poll shows the result. */
  async checkUpdate(): Promise<void> {
    await this.run(async (client) => {
      this.show(client, { update: toUpdate(await client.call("update_check")), error: null });
    });
  }

  /** `update_install`: the board downloads the version the last check found. `force` installs a skipped version. */
  async installUpdate(force: boolean): Promise<void> {
    await this.run(async (client) => {
      const update = toUpdate(
        await client.call("update_install", { target: "firmware", ...(force ? { force: true } : {}) }),
      );
      this.show(client, { update, error: null });
    });
  }

  /** `update_install` of the web app: the board installs the version the last check found, without a restart. */
  async installWebUpdate(): Promise<void> {
    await this.run(async (client) => {
      const update = toUpdate(await client.call("update_install", { target: "web" }));
      this.show(client, { update, error: null });
    });
  }

  /** Logs in with the token the person typed, while the phase is `login`. The token stays in memory. */
  async submitToken(token: string): Promise<void> {
    if (this.state.phase !== "login") return;
    const text = token.trim();
    if (!isToken(text)) {
      this.update({ loginProblem: message("errors:login.tokenShape") });
      return;
    }
    if (this.state.loginIdle) {
      await this.loginAgain(text);
      return;
    }
    const client = this.client;
    const info = this.state.info;
    if (!client || !info) return;
    const generation = this.generation;
    await this.loginWith(client, info, text, () => {
      if (generation === this.generation) this.update({ loginProblem: message("errors:login.tokenWrong") });
    });
  }

  /** The board closed the idle prompt's connection: opens it again quietly and logs in with the token just typed. */
  private async loginAgain(token: string): Promise<void> {
    this.token = token;
    this.update({ loginProblem: null });
    await this.reconnect(true);
    if (this.phase() !== "login") return;
    if (this.client === null) {
      this.token = null;
      this.update({ loginIdle: true, loginProblem: message("errors:login.noAnswer") });
    } else {
      this.token = null;
      this.update({ loginProblem: message("errors:login.tokenWrong") });
    }
  }

  /** Logs in with `token`: on success the token is kept, the handshake finishes and the request that was refused runs
   * again; `refused` is called when the board does not accept it. */
  private async loginWith(client: Client, info: BoardInfo, token: string, refused: () => void): Promise<void> {
    const generation = this.generation;
    try {
      if (!(await this.tryLogin(client, token))) {
        refused();
        return;
      }
      this.token = token;
      await this.complete(client, info, generation);
      const retry = this.pendingRetry;
      this.pendingRetry = null;
      if (retry && this.phase() === "connected") await retry();
    } catch (error) {
      if (this.client === client) this.fail(error);
    }
  }

  /** Shows what a request learned, unless its connection has been closed or replaced meanwhile: a late reply of an old
   * connection must not touch the state of the new one. */
  private show(client: Client, patch: Partial<BoardState>): void {
    if (this.client === client) this.update(patch);
  }

  private async refreshLight(client: Client): Promise<void> {
    try {
      this.show(client, statusPatch(toStatus(await client.call("status"))));
    } catch {
      // the error being reported is the one that matters
    }
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
  private async run(request: (client: Client, info: BoardInfo) => Promise<void>): Promise<boolean> {
    const client = this.client;
    const info = this.state.info;
    if (!client || !info || this.state.phase !== "connected") return false;
    try {
      await request(client, info);
      return true;
    } catch (error) {
      if (this.client !== client) return false;
      if (isUnauthorized(error) && client.kind === "websocket") {
        this.pendingRetry = async () => void (await this.run(request));
        this.stopPolling();
        this.update({ phase: "login", loginProblem: null });
        // A token kept from earlier is tried first, so a board that only forgot the login is not a question to the person
        if (this.token !== null) await this.submitStored(client, info);
        return false;
      }
      this.fail(error);
      return false;
    }
  }

  /** Logs in with the token kept in memory; when the board refuses it, the person is asked. */
  private async submitStored(client: Client, info: BoardInfo): Promise<void> {
    if (this.token !== null) await this.loginWith(client, info, this.token, () => undefined);
  }

  private fail(error: unknown): void {
    if (error instanceof ClientError && (error.failure === "no_reply" || error.failure === "closed")) {
      this.lose(error);
    } else {
      this.update({ error: errorMessage(error) });
    }
  }

  /** The connection ended without a request noticing: the board closed it, or the cable was pulled. */
  private ended(client: Client, error: ClientError): void {
    if (this.client !== client || (this.state.phase !== "connected" && this.state.phase !== "login")) return;
    const idleClose = error.closeCode === undefined || (error.closeCode === 1008 && this.refusedTokens < 3);
    if (this.state.phase === "login" && idleClose) {
      // The board closes a connection that has not logged in after 10 s (docs/board/wifi-and-updates-v1.md#network-login).
      // The prompt and what was typed stay; the next try opens the connection again, and nothing reconnects meanwhile.
      this.stopPolling();
      this.client = null;
      void client.close().catch(() => undefined);
      this.update({ loginIdle: true, loginProblem: null });
      return;
    }
    this.lose(error);
  }

  private lose(error?: unknown, reason?: Message): void {
    const client = this.client;
    if (client === null) return;
    // The board installed a new web app. A page it served loads again to get it; any other page connects again.
    const newApp = error instanceof ClientError && error.closeCode === CLOSE_RELOAD;
    if (newApp && this.state.served !== null) {
      this.stopPolling();
      this.client = null;
      void client.close().catch(() => undefined);
      this.reload();
      return;
    }
    if (newApp) this.expectDrop = true;
    this.stopPolling();
    this.client = null;
    void client.close().catch(() => undefined);
    // A web app install does not restart the board: only a firmware one does
    const update = this.state.update;
    const restarting = update !== null && update.target !== "web" && RESTARTING_STATES.includes(update.state);
    const drop = this.expectDrop;
    this.expectDrop = false;
    const auto = restarting ? "restarting" : drop ? "reconnecting" : null;
    this.update({
      phase: "lost",
      auto,
      error: auto ? null : (reason ?? (error === undefined ? NO_ANSWER : errorMessage(error))),
    });
    if (auto) void this.reconnectByItself(auto);
  }

  /**
   * Opens a lost connection again, quietly, every few seconds for about a minute: a board that installed firmware is
   * back in a few seconds, and one that closed the connection to ask for the login is back at once. A person who
   * disconnects, or a newer connection, stops it.
   */
  private async reconnectByItself(auto: "restarting" | "reconnecting"): Promise<void> {
    const run = ++this.retryRun;
    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, auto === "reconnecting" ? Math.min(this.retryMs, 1000) : this.retryMs),
      );
      if (run !== this.retryRun || this.state.phase !== "lost") return;
      await this.reconnect(true);
      if (run !== this.retryRun) return;
      if (this.phase() === "connected" || this.phase() === "login") return;
    }
    if (run === this.retryRun && this.state.phase === "lost") {
      this.update({ auto: null, error: message("errors:didNotComeBack") });
    }
  }

  private startPolling(generation: number): void {
    this.stopPolling();
    const poll = async (): Promise<void> => {
      const client = this.client;
      if (!client || generation !== this.generation || client.busy || this.visibility?.hidden()) return;
      try {
        // A request the person makes meanwhile goes first: the poll gives way and asks again next time
        const reply = await client.poll("status");
        if (reply === null || generation !== this.generation) return;
        const status = toStatus(reply);
        // Most polls bring what the page already shows: do not wake every subscriber for them. `time.epoch` moves every
        // second on a synced board and nothing on the page shows it, so it does not count as a change.
        const patch = statusPatch(status);
        const shown = (value: unknown): string =>
          JSON.stringify(value, (key, v: unknown) => (key === "epoch" ? undefined : v));
        const keys = Object.keys(patch) as (keyof BoardState)[];
        if (keys.some((key) => shown(patch[key]) !== shown(this.state[key]))) this.update(patch);
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
