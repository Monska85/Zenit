// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_MS, BoardSession, OpenFailed, type Visibility } from "../src/board/session";
import { FakeBoard, INFO, ScriptedTransport, TIME_STATUS, lineOf } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function connected(
  board = new FakeBoard(),
  visibility: Visibility | null = null,
  kind: "usb" | "websocket" = "websocket",
) {
  const session = new BoardSession(visibility);
  const transport = board.transport(kind);
  const done = session.connect(transport, "test");
  await vi.advanceTimersByTimeAsync(0);
  await done;
  return { session, board, transport };
}

const commands = (board: FakeBoard): string[] => board.requests.map((request) => String(request["cmd"]));

describe("BoardSession.connect", () => {
  it("asks info first, then the settings and the light, and shows them", async () => {
    const { session, board } = await connected();
    expect(commands(board)).toEqual(["info", "settings_get", "status"]);
    const state = session.getState();
    expect(state.phase).toBe("connected");
    expect(state.kind).toBe("websocket");
    expect(state.info?.firmware).toBe("1.2.3");
    expect(state.settings?.brightness).toBe(60);
    expect(state.light?.on).toBe(true);
    expect(state.error).toBeNull();
  });

  it("is connecting while it waits for the board", async () => {
    const session = new BoardSession();
    const board = new FakeBoard();
    const transport = board.transport();
    transport.respond = () => [];
    const phases: string[] = [];
    session.subscribe(() => phases.push(session.getState().phase));
    void session.connect(transport, "x");
    await vi.advanceTimersByTimeAsync(100);
    expect(session.getState().phase).toBe("connecting");
    await session.disconnect();
    expect(phases).toContain("connecting");
  });

  it("gives up with a sentence when the board never answers", async () => {
    const board = new FakeBoard();
    board.silent = true;
    const session = new BoardSession();
    const transport = board.transport();
    const done = session.connect(transport, "x");
    await vi.advanceTimersByTimeAsync(2000 * 5 + 100);
    await done;
    expect(session.getState().phase).toBe("disconnected");
    expect(session.getState().error).toContain("did not answer");
    expect(transport.closed).toBe(true);
  });

  it("refuses a board of another protocol", async () => {
    const session = new BoardSession();
    const transport = new ScriptedTransport();
    transport.respond = (request) => [{ seq: request["seq"], ok: true, ...INFO, protocol: 2 }];
    await session.connect(transport, "x");
    expect(session.getState().phase).toBe("disconnected");
    expect(session.getState().error).toContain("newer protocol");
  });

  it("refuses settings that name an effect the board does not list", async () => {
    const board = new FakeBoard();
    // Out-of-range values are malformed replies (conformance/client/replies.json); this one is well formed
    board.settings["effect"] = "laser";
    const session = new BoardSession();
    const done = session.connect(board.transport(), "x");
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(session.getState().phase).toBe("disconnected");
    expect(session.getState().error).not.toBeNull();
  });

  it("closes the old connection when a new one starts", async () => {
    const { session, transport } = await connected();
    const second = new FakeBoard().transport();
    const done = session.connect(second, "second");
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(transport.closed).toBe(true);
    expect(session.getState().label).toBe("second");
  });
});

describe("BoardSession.setSettings", () => {
  it("sends only what the user chose and shows what the board holds afterwards", async () => {
    const { session, board } = await connected();
    await session.setSettings({ effect: "breathing" });
    expect(board.requests.at(-1)).toMatchObject({ cmd: "settings_set", effect: "breathing" });
    expect(Object.keys(board.requests.at(-1) ?? {}).sort()).toEqual(["cmd", "effect", "seq"]);
    expect(session.getState().settings?.effect).toBe("breathing");
  });

  it("shows the board's settings, with a sentence, when the board refuses", async () => {
    const { session, board } = await connected();
    board.errors.set("settings_set", "bad_request");
    await session.setSettings({ brightness: 5 });
    expect(session.getState().error).toBe("Zenit did not accept that value.");
    expect(session.getState().settings?.brightness).toBe(60);
    expect(commands(board).slice(-2)).toEqual(["settings_set", "settings_get"]);
    session.dismissError();
    expect(session.getState().error).toBeNull();
  });

  it("never shows the board's own message", async () => {
    const { session, board } = await connected();
    board.errors.set("settings_set", "storage_error");
    await session.setSettings({ brightness: 5 });
    expect(session.getState().error).toContain("could not save");
    expect(session.getState().error).not.toContain("for logs");
  });

  it("refuses to show settings that name a color the board does not list", async () => {
    const { session, board, transport } = await connected();
    transport.respond = (request) => {
      board.answer(request);
      return [{ seq: request["seq"], ok: true, settings: { ...board.settings, color: "purple" } }];
    };
    await session.setSettings({ brightness: 5 });
    expect(session.getState().error).not.toBeNull();
    expect(session.getState().settings?.color).toBe("white");
  });

  it("is lost when the board stops answering", async () => {
    const { session, board } = await connected();
    board.silent = true;
    const done = session.setSettings({ brightness: 5 });
    await vi.advanceTimersByTimeAsync(2000 * 5 + 100);
    await done;
    expect(session.getState().phase).toBe("lost");
    expect(session.getState().error).toContain("did not answer");
  });

  it("does nothing when there is no connection", async () => {
    const session = new BoardSession();
    await session.setSettings({ brightness: 5 });
    await session.setPower(true);
    expect(session.getState().phase).toBe("disconnected");
  });
});

describe("BoardSession.setPower and resetSettings", () => {
  it("turns the light off and on", async () => {
    const { session, board } = await connected();
    await session.setPower(false);
    expect(board.requests.at(-1)).toMatchObject({ cmd: "light", on: false });
    expect(session.getState().light).toMatchObject({ on: false, color: null });
    await session.setPower(true);
    expect(session.getState().light?.on).toBe(true);
  });

  it("resets and shows the defaults", async () => {
    const { session, board } = await connected(new FakeBoard(), null, "usb");
    await session.setSettings({ brightness: 5 });
    await session.resetSettings();
    expect(commands(board).slice(-2)).toEqual(["settings_reset", "status"]);
    expect(session.getState().settings?.brightness).toBe(60);
  });

  it("reads the ready-made favorites again after a reset", async () => {
    const board = new FakeBoard();
    board.withFavorites();
    const { session } = await connected(board, null, "usb");
    await session.deleteFavorite(1);
    await session.setStartFavorite(2);
    await session.resetSettings();
    expect(commands(board).slice(-3)).toEqual(["settings_reset", "favorites", "status"]);
    expect(session.getState().favorites?.map((f) => f.name)).toEqual(["Starry night", "Christmas"]);
    expect(session.getState().start).toBeNull();
  });

  it("shows what the board holds when a reset fails after it reset the settings", async () => {
    const board = new FakeBoard().withFavorites();
    const { session } = await connected(board, null, "usb");
    await session.setSettings({ brightness: 5 });
    await session.deleteFavorite(1);
    board.resetFailsAfter = true;
    await session.resetSettings();
    expect(commands(board).slice(-4)).toEqual(["settings_reset", "settings_get", "favorites", "status"]);
    const state = session.getState();
    expect(state.settings?.brightness).toBe(60);
    expect(state.favorites?.map((f) => f.name)).toEqual(["Starry night", "Christmas"]);
    expect(state.error).toContain("could not save");
  });

  it("says a reset needs USB when the board says so", async () => {
    const { session, board } = await connected();
    board.errors.set("settings_reset", "usb_only");
    await session.resetSettings();
    expect(session.getState().error).toBe("This works only with a USB cable.");
    expect(session.getState().phase).toBe("connected");
  });
});

describe("polling", () => {
  it("asks status once a second and shows the light", async () => {
    const { session, board } = await connected();
    const before = commands(board).length;
    board.on = false;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(commands(board).slice(before)).toEqual(["status"]);
    expect(session.getState().light?.on).toBe(false);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(commands(board).slice(before)).toEqual(["status", "status", "status", "status"]);
  });

  it("notifies subscribers once for status replies that did not change", async () => {
    const { session, board } = await connected(new FakeBoard().withNetwork());
    let notified = 0;
    session.subscribe(() => notified++);
    // A synced board's clock moves at every reply; nothing the page shows does
    for (let i = 0; i < 3; i++) {
      board.time = { ...TIME_STATUS, epoch: TIME_STATUS.epoch + i + 1 };
      await vi.advanceTimersByTimeAsync(POLL_MS);
    }
    expect(notified).toBe(0);
    board.on = false;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(notified).toBe(1);
    expect(session.getState().light?.on).toBe(false);
  });

  it("does not ask while the page is hidden, and asks once when it is shown", async () => {
    let hidden = true;
    let shown: () => void = () => undefined;
    const visibility: Visibility = {
      hidden: () => hidden,
      onShown: (listener) => {
        shown = listener;
        return () => undefined;
      },
    };
    const { board } = await connected(new FakeBoard(), visibility);
    const before = commands(board).length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(commands(board)).toHaveLength(before);
    hidden = false;
    shown();
    await vi.advanceTimersByTimeAsync(0);
    expect(commands(board)).toHaveLength(before + 1);
  });

  it("never asks while another request is in flight", async () => {
    const { session, board } = await connected();
    const before = commands(board).length;
    board.silent = true;
    const done = session.setSettings({ brightness: 5 });
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(new Set(commands(board).slice(before))).toEqual(new Set(["settings_set"]));
    board.silent = false;
    await vi.advanceTimersByTimeAsync(2000);
    await done;
  });

  it("sends a choice at once while a status poll waits for its reply, and shows the board's answer", async () => {
    const { session, board, transport } = await connected();
    // The board's answers to status are held back: the next poll stays in flight
    const answer = transport.respond;
    const held: Uint8Array[] = [];
    transport.respond = (request, line) => {
      const replies = answer(request, line);
      if (request["cmd"] !== "status") return replies;
      held.push(...replies.map((reply) => (reply instanceof Uint8Array ? reply : lineOf(reply))));
      return [];
    };
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(commands(board).at(-1)).toBe("status");
    const done = session.setSettings({ brightness: 5 });
    await vi.advanceTimersByTimeAsync(0);
    expect(commands(board).at(-1)).toBe("settings_set");
    expect(board.settings["brightness"]).toBe(5);
    await done;
    expect(session.getState().settings?.brightness).toBe(5);
    // The poll's late reply changes nothing, and the next poll asks again
    for (const line of held) transport.receive(line);
    transport.respond = answer;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(commands(board).at(-1)).toBe("status");
    expect(session.getState().phase).toBe("connected");
    expect(session.getState().error).toBeNull();
  });

  it("stops after disconnect", async () => {
    const { session, board } = await connected();
    await session.disconnect();
    const before = commands(board).length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(commands(board)).toHaveLength(before);
    expect(session.getState().phase).toBe("disconnected");
    expect(session.getState().settings).toBeNull();
  });

  it("is lost when the link drops", async () => {
    const { session, transport } = await connected();
    transport.drop(new Error("unplugged"));
    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    expect(session.getState().phase).toBe("lost");
    expect(session.getState().error).toContain("did not answer");
    // the last values stay on screen, greyed out by the view
    expect(session.getState().settings).not.toBeNull();
  });

  it("is lost when the board falls silent", async () => {
    const { session, board } = await connected();
    board.silent = true;
    await vi.advanceTimersByTimeAsync(POLL_MS + 2000 * 5 + 100);
    expect(session.getState().phase).toBe("lost");
  });

  it("does not show a banner for a status the board refuses", async () => {
    const { session, board } = await connected();
    board.errors.set("status", "busy");
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(session.getState().error).toBeNull();
    expect(session.getState().phase).toBe("connected");
  });
});

describe("BoardSession.open", () => {
  it("connects over what the opener gives, and shows nothing wrong", async () => {
    const session = new BoardSession();
    const board = new FakeBoard();
    const done = session.open(async () => board.transport(), "x");
    expect(session.getState().opening).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(session.getState()).toMatchObject({ phase: "connected", opening: false, error: null });
  });

  it("ignores a second open while one is opening, and while one is connecting", async () => {
    const session = new BoardSession();
    let release: (value: ScriptedTransport) => void = () => undefined;
    const first = vi.fn(() => new Promise<ScriptedTransport>((resolve) => (release = resolve)));
    const second = vi.fn(async () => new FakeBoard().transport());
    const opening = session.open(first, "first");
    await session.open(second, "second");
    expect(second).not.toHaveBeenCalled();
    release(new FakeBoard().transport());
    await vi.advanceTimersByTimeAsync(0);
    await opening;
    expect(session.getState().label).toBe("first");
    // While it connects (the board has not answered yet), a second one is ignored as well
    const slow = new FakeBoard();
    slow.silent = true;
    const again = new BoardSession();
    const connecting = again.open(async () => slow.transport(), "slow");
    await vi.advanceTimersByTimeAsync(100);
    expect(again.getState().phase).toBe("connecting");
    await again.open(second, "other");
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000 * 5 + 100);
    await connecting;
  });

  it("leaves a live connection alone when the new one cannot be opened", async () => {
    const { session, board, transport } = await connected();
    const before = board.requests.length;
    await session.open(() => Promise.reject(new OpenFailed("The USB port could not be opened.")), "usb");
    expect(session.getState()).toMatchObject({
      phase: "connected",
      opening: false,
      error: "The USB port could not be opened.",
    });
    expect(session.getState().settings).not.toBeNull();
    expect(transport.closed).toBe(false);
    // and it is still the connection that polls
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(board.requests.length).toBeGreaterThan(before);
    await session.setSettings({ brightness: 5 });
    expect(session.getState().settings?.brightness).toBe(5);
  });

  it("leaves a live connection alone when the person closes the chooser", async () => {
    const { session, transport } = await connected();
    await session.open(async () => null, "usb");
    expect(session.getState()).toMatchObject({ phase: "connected", opening: false, error: null });
    expect(transport.closed).toBe(false);
  });

  it("allows a new attempt after a failed one", async () => {
    const session = new BoardSession();
    await session.open(() => Promise.reject(new OpenFailed("no")), "x");
    expect(session.getState()).toMatchObject({ phase: "disconnected", error: "no", opening: false });
    const done = session.open(async () => new FakeBoard().transport(), "x");
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(session.getState().phase).toBe("connected");
  });

  it("opens a lost connection again the same way, and keeps the last values until it does", async () => {
    const board = new FakeBoard();
    const session = new BoardSession();
    const opener = vi.fn(async () => board.transport());
    const first = session.open(opener, "ws://zenit.test/ws");
    await vi.advanceTimersByTimeAsync(0);
    await first;
    board.silent = true;
    await vi.advanceTimersByTimeAsync(POLL_MS + 2000 * 5 + 100);
    expect(session.getState().phase).toBe("lost");
    expect(session.getState().settings).not.toBeNull();
    // the open fails: the last values stay
    opener.mockRejectedValueOnce(new OpenFailed("Could not reach Zenit."));
    await session.reconnect();
    expect(session.getState()).toMatchObject({ phase: "lost", error: "Could not reach Zenit." });
    expect(session.getState().settings).not.toBeNull();
    board.silent = false;
    const again = session.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    await again;
    expect(opener).toHaveBeenCalledTimes(3);
    expect(session.getState()).toMatchObject({ phase: "connected", label: "ws://zenit.test/ws" });
  });

  it("does nothing to reconnect before any connection was tried", async () => {
    const session = new BoardSession();
    await session.reconnect();
    expect(session.getState().phase).toBe("disconnected");
  });
});

describe("BoardSession.disconnect", () => {
  it("says whether the port was released", async () => {
    const { session } = await connected();
    expect(await session.disconnect()).toBe(true);
    const second = await connected();
    second.transport.close = () => Promise.reject(new Error("stuck"));
    expect(await second.session.disconnect()).toBe(false);
    expect(second.session.getState().phase).toBe("disconnected");
  });
});

describe("late replies of an old connection", () => {
  /** A board whose reply to the named command is held until `release()`. */
  function held(board: FakeBoard, transport: ScriptedTransport, command: string) {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    transport.respond = (request) => {
      const replies = board.answer(request);
      if (request["cmd"] !== command) return replies;
      void gate.then(() => replies.forEach((reply) => transport.receive(lineOf(reply))));
      return [];
    };
    return release;
  }

  it("does not change the state after a disconnect", async () => {
    const { session, board, transport } = await connected();
    // A transport that goes on delivering after close, as a socket can for a moment: the reply still resolves
    transport.close = async () => undefined;
    const release = held(board, transport, "settings_set");
    const done = session.setSettings({ brightness: 5 });
    await vi.advanceTimersByTimeAsync(10);
    await session.disconnect();
    release();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(session.getState()).toMatchObject({ phase: "disconnected", settings: null, light: null, error: null });
  });

  it.each([
    ["settings_set", (session: BoardSession) => session.setSettings({ brightness: 5 })],
    ["light", (session: BoardSession) => session.setPower(false)],
    ["settings_reset", (session: BoardSession) => session.resetSettings()],
  ])("does not change the new connection when the %s reply comes after a reconnect", async (command, act) => {
    const first = new FakeBoard();
    const firstTransport = first.transport();
    const second = new FakeBoard();
    second.settings["brightness"] = 33;
    const transports = [firstTransport, second.transport()];
    const session = new BoardSession();
    const opener = async () => transports.shift() as ScriptedTransport;
    const a = session.open(opener, "x");
    await vi.advanceTimersByTimeAsync(0);
    await a;
    firstTransport.close = async () => undefined;
    const release = held(first, firstTransport, command);
    const late = act(session);
    await vi.advanceTimersByTimeAsync(10);
    // the connection is replaced before the reply comes
    const again = session.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    await again;
    release();
    await vi.advanceTimersByTimeAsync(10);
    await late;
    expect(session.getState().phase).toBe("connected");
    expect(session.getState().settings?.brightness).toBe(33);
    expect(session.getState().light?.on).toBe(true);
    expect(session.getState().error).toBeNull();
  });

  it("does not show the refresh after a refused value on a replaced connection", async () => {
    const { session, board, transport } = await connected();
    board.errors.set("settings_set", "bad_request");
    transport.close = async () => undefined;
    const release = held(board, transport, "settings_set");
    const done = session.setSettings({ brightness: 5 });
    await vi.advanceTimersByTimeAsync(10);
    await session.disconnect();
    release();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(session.getState()).toMatchObject({ phase: "disconnected", settings: null, error: null });
    // nothing asked the board for its settings again on behalf of the closed connection
    expect(
      board.requests.map((request) => request["cmd"]).filter((command) => command === "settings_get"),
    ).toHaveLength(1);
  });
});

describe("the connection Reconnect opens", () => {
  it("stays the last one that connected, whatever was tried since", async () => {
    const board = new FakeBoard();
    const session = new BoardSession();
    const address = vi.fn(async () => board.transport());
    const first = session.open(address, "ws://zenit.test/ws");
    await vi.advanceTimersByTimeAsync(0);
    await first;
    board.silent = true;
    await vi.advanceTimersByTimeAsync(POLL_MS + 2000 * 5 + 100);
    expect(session.getState().phase).toBe("lost");
    // another method is tried and cancelled, another address cannot be reached
    const usb = vi.fn(async () => null);
    await session.open(usb, "USB");
    const other = vi.fn(() => Promise.reject(new OpenFailed("Could not reach Zenit.")));
    await session.open(other, "ws://other.test/ws");
    board.silent = false;
    const again = session.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    await again;
    expect(address).toHaveBeenCalledTimes(2);
    expect(usb).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ phase: "connected", label: "ws://zenit.test/ws" });
  });

  it("is not replaced by a connection whose handshake fails", async () => {
    const board = new FakeBoard();
    const session = new BoardSession();
    const good = vi.fn(async () => board.transport());
    const a = session.open(good, "good");
    await vi.advanceTimersByTimeAsync(0);
    await a;
    const mute = new FakeBoard();
    mute.silent = true;
    const b = session.open(async () => mute.transport(), "mute");
    await vi.advanceTimersByTimeAsync(2000 * 5 + 100);
    await b;
    expect(session.getState().phase).toBe("disconnected");
    const c = session.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    await c;
    expect(good).toHaveBeenCalledTimes(2);
  });
});

describe("favorites", () => {
  const withFavorites = () => new FakeBoard().withFavorites();
  const marked = (board: FakeBoard) => board.favorites!.map((item) => item["name"]);

  it("reads the list after the settings, before the Light view shows, and keeps it", async () => {
    const { session, board } = await connected(withFavorites());
    expect(commands(board)).toEqual(["info", "settings_get", "favorites", "status"]);
    expect(session.getState().favorites?.map((item) => item.name)).toEqual(["Starry night", "Christmas"]);
    expect(session.getState().start).toBeNull();
  });

  it("does not ask for favorites from a board that reports no limits", async () => {
    const { session, board } = await connected();
    expect(commands(board)).toEqual(["info", "settings_get", "status"]);
    expect(session.getState().favorites).toBeNull();
  });

  it("applies a favorite: the reply updates the light and the settings", async () => {
    const board = withFavorites();
    board.on = false;
    const { session } = await connected(board);
    expect(await session.applyFavorite(2)).toMatchObject({ ok: true, code: null });
    const state = session.getState();
    expect(state.light?.on).toBe(true);
    expect(state.settings?.effect).toBe("christmas");
    expect(state.settings?.hold_seconds).toBe(30);
  });

  it("saves a new favorite from the light as it is, replaces one, renames, marks and deletes", async () => {
    const { session, board } = await connected(withFavorites());
    await session.setSettings({ effect: "breathing", brightness: 40 });
    expect(await session.saveFavorite("Bedtime")).toMatchObject({ ok: true, code: null });
    expect(session.getState().favorites?.at(-1)).toMatchObject({
      name: "Bedtime",
      effect: "breathing",
      brightness: 40,
    });
    expect(await session.replaceFavorite(1)).toMatchObject({ ok: true, code: null });
    expect(session.getState().favorites?.[0]).toMatchObject({
      name: "Starry night",
      effect: "breathing",
      brightness: 40,
    });
    expect(await session.renameFavorite(1, "Night")).toMatchObject({ ok: true, code: null });
    expect(await session.setStartFavorite(1)).toMatchObject({ ok: true, code: null });
    expect(session.getState().start).toBe(1);
    expect(await session.deleteFavorite(1)).toMatchObject({ ok: true, code: null });
    expect(session.getState().start).toBeNull();
    expect(marked(board)).toEqual(["Christmas", "Bedtime"]);
    expect(session.getState().favorites?.map((item) => item.name)).toEqual(["Christmas", "Bedtime"]);
    expect(await session.setStartFavorite(null)).toMatchObject({ ok: true, code: null });
    expect(board.requests.at(-1)).toMatchObject({ cmd: "favorite_start", id: null });
  });

  it("reads the settings after a turn-on while a favorite is marked, and not otherwise", async () => {
    const board = withFavorites();
    const { session } = await connected(board);
    await session.setPower(false);
    await session.setPower(true);
    expect(commands(board).slice(-2)).toEqual(["light", "light"]);
    await session.setStartFavorite(2);
    await session.setPower(false);
    await session.setPower(true);
    expect(commands(board).slice(-2)).toEqual(["light", "settings_get"]);
    expect(session.getState().settings?.effect).toBe("christmas");
    await session.setPower(false);
    expect(commands(board).at(-1)).toBe("light");
  });

  it("reads the list again after an error and shows the sentence in the bottom message", async () => {
    const { session, board } = await connected(withFavorites());
    // Another phone deleted the favorite
    board.favorites = board.favorites!.filter((item) => item["id"] !== 1);
    expect(await session.applyFavorite(1)).toMatchObject({ ok: false, code: "unknown_favorite" });
    expect(commands(board).slice(-2)).toEqual(["favorite_apply", "favorites"]);
    expect(session.getState().favorites?.map((item) => item.name)).toEqual(["Christmas"]);
    expect(session.getState().error).toBe("That favorite is no longer on Zenit.");
  });

  it("returns a name error for the dialog and shows no bottom message", async () => {
    const { session } = await connected(withFavorites());
    expect(await session.saveFavorite("christmas")).toMatchObject({ ok: false, code: "name_taken" });
    expect(session.getState().error).toBeNull();
    expect(await session.renameFavorite(1, "christmas")).toMatchObject({ ok: false, code: "name_taken" });
    expect(session.getState().error).toBeNull();
  });

  it("gives the sentence of a refusal to the dialog that asked, and keeps it out of the bottom message", async () => {
    const { session, board } = await connected(withFavorites());
    for (const name of ["a", "b", "c", "d"]) await session.saveFavorite(name);
    expect(await session.saveFavorite("e")).toMatchObject({
      ok: false,
      code: "favorites_full",
      nameProblem: false,
      message: "Your favorites are full. Delete one first.",
    });
    board.errors.set("favorite_rename", "bad_name");
    expect(await session.renameFavorite(1, "x")).toMatchObject({
      code: "bad_name",
      nameProblem: true,
      message: "Zenit did not accept that name.",
    });
    board.errors.set("favorite_delete", "storage_error");
    const refused = await session.deleteFavorite(1);
    expect(refused).toMatchObject({ ok: false, code: "storage_error", nameProblem: false });
    expect(refused.message).toContain("could not save");
    expect(session.getState().error).toBeNull();
  });

  it("shows a refused tile in the bottom message, as a request of the page", async () => {
    const { session, board } = await connected(withFavorites());
    board.errors.set("favorite_apply", "storage_error");
    expect(await session.applyFavorite(1)).toMatchObject({ ok: false, code: "storage_error", message: null });
    expect(session.getState().error).toContain("could not save");
  });

  it("does nothing, and says it did not work, when the connection is not there", async () => {
    const session = new BoardSession();
    expect(await session.saveFavorite("Bedtime")).toMatchObject({ ok: false, code: null });
  });

  it("lets a poll give way to a favorites request", async () => {
    const board = withFavorites();
    const { session } = await connected(board);
    const before = commands(board).length;
    const request = session.setStartFavorite(2);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await request;
    expect(commands(board).slice(before)).toContain("favorite_start");
    expect(session.getState().start).toBe(2);
  });

  it("forgets the favorites with the connection", async () => {
    const { session } = await connected(withFavorites());
    await session.disconnect();
    expect(session.getState().favorites).toBeNull();
    expect(session.getState().start).toBeNull();
  });
});
