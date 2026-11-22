// SPDX-License-Identifier: GPL-3.0-or-later

// The session with a board from the WiFi and updates milestone: status parts, the login, the commands that belong to it,
// the connection that closes on purpose, and the reconnection after a restart.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardSession, POLL_MS } from "../src/board/session";
import { CLOSE_MESSAGES } from "../src/board/messages";
import { ConnectionClosed } from "../src/protocol/transport";
import { FakeBoard, TOKEN, UPDATE_STATUS, type ScriptedTransport } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const commands = (board: FakeBoard): string[] => board.requests.map((request) => String(request["cmd"]));
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

function networked(patch: (board: FakeBoard) => void = () => undefined): FakeBoard {
  const board = new FakeBoard().withNetwork();
  patch(board);
  return board;
}

/** Opens a connection the way the app does, so Reconnect has something to reopen. */
async function opened(board: FakeBoard, kind: "usb" | "websocket" = "websocket", options = {}) {
  const session = new BoardSession(null, { retryMs: 10, retryAttempts: 5, ...options });
  const transports: ScriptedTransport[] = [];
  const opener = () => {
    const transport = board.transport(kind);
    transports.push(transport);
    return Promise.resolve(transport);
  };
  const done = session.open(opener, "test");
  await settle();
  await done;
  return { session, transports, opener };
}

describe("status parts", () => {
  it("shows the WiFi, time and update parts the board reports", async () => {
    const { session } = await opened(networked());
    const state = session.getState();
    expect(state.wifi?.hostname).toBe("zenit-a1b2");
    expect(state.time?.synced).toBe(true);
    expect(state.update?.mode).toBe("automatic");
  });

  it("leaves them null for a board from before the milestone", async () => {
    const { session } = await opened(new FakeBoard());
    const state = session.getState();
    expect([state.wifi, state.time, state.update]).toEqual([null, null, null]);
  });

  it("follows the update while it polls", async () => {
    const board = networked();
    const { session } = await opened(board);
    board.update = { ...board.update, state: "downloading", progress: 40 };
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(session.getState().update).toMatchObject({ state: "downloading", progress: 40 });
  });
});

describe("the login", () => {
  const protectedBoard = () => networked((board) => (board.settings["network_login"] = true));

  it("waits for the token when the board asks for it, and then loads everything", async () => {
    const board = protectedBoard();
    const { session } = await opened(board);
    expect(session.getState().phase).toBe("login");
    expect(session.getState().info).not.toBeNull();
    expect(session.getState().settings).toBeNull();
    await session.submitToken(TOKEN);
    expect(session.getState().phase).toBe("connected");
    expect(session.getState().settings?.network_login).toBe(true);
    expect(commands(board)).toContain("auth");
  });

  it("says when the token is not right, and does not ask the board for a token of the wrong shape", async () => {
    const board = protectedBoard();
    const { session } = await opened(board);
    const before = board.requests.length;
    await session.submitToken("short");
    expect(session.getState().loginProblem).toContain("16 characters");
    expect(board.requests.length).toBe(before);
    await session.submitToken("zzzzzzzzzzzzzzzz");
    expect(session.getState().loginProblem).toContain("not right");
    expect(session.getState().phase).toBe("login");
  });

  it("says the connection was closed after three wrong tokens", async () => {
    const board = protectedBoard();
    const { session } = await opened(board);
    for (let i = 0; i < 3; i++) {
      await session.submitToken("zzzzzzzzzzzzzzzz");
      await settle();
    }
    expect(session.getState().phase).toBe("lost");
    expect(session.getState().error).toBe(CLOSE_MESSAGES[1008]);
  });

  it("keeps the prompt when the board closes a connection that never logged in, and does not reconnect by itself", async () => {
    const { session, transports } = await opened(protectedBoard());
    transports[0]?.drop();
    await settle();
    expect(session.getState()).toMatchObject({ phase: "login", loginIdle: true, loginProblem: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transports).toHaveLength(1);
    expect(session.getState().phase).toBe("login");
  });

  it("takes the board's 1008 for an idle close until three tokens were refused", async () => {
    const { session, transports } = await opened(protectedBoard());
    transports[0]?.drop(new ConnectionClosed(1008, ""));
    await settle();
    expect(session.getState()).toMatchObject({ phase: "login", loginIdle: true });
    await session.submitToken(TOKEN);
    expect(session.getState().phase).toBe("connected");
  });

  it("opens the connection again when the token is typed after the board closed the idle one", async () => {
    const { session, transports } = await opened(protectedBoard());
    transports[0]?.drop();
    await settle();
    await session.submitToken(TOKEN);
    expect(transports).toHaveLength(2);
    expect(session.getState()).toMatchObject({ phase: "connected", loginIdle: false, loginProblem: null });
  });

  it("says the token is wrong when the reopened connection refuses it, and keeps the prompt", async () => {
    const { session, transports } = await opened(protectedBoard());
    transports[0]?.drop();
    await settle();
    await session.submitToken("zzzzzzzzzzzzzzzz");
    expect(session.getState().phase).toBe("login");
    expect(session.getState().loginProblem).toContain("not right");
    await session.submitToken(TOKEN);
    expect(session.getState().phase).toBe("connected");
  });

  it("keeps the token in memory and uses it when the board asks again", async () => {
    const board = protectedBoard();
    const { session, opener } = await opened(board);
    await session.submitToken(TOKEN);
    await session.disconnect();
    const transport = board.transport("websocket");
    await session.connect(transport, "again");
    expect(session.getState().phase).toBe("connected");
    void opener;
  });

  it("asks again, and runs the refused request after the login, when a command is refused later", async () => {
    const board = networked();
    const { session } = await opened(board);
    board.settings["network_login"] = true;
    board.openConnection(); // the board forgot the login
    await session.setSettings({ brightness: 33 });
    expect(session.getState().phase).toBe("login");
    await session.submitToken(TOKEN);
    expect(session.getState().phase).toBe("connected");
    expect(board.settings["brightness"]).toBe(33);
  });

  it("never writes the token to the browser's storage", async () => {
    const stored: string[] = [];
    vi.stubGlobal("localStorage", {
      setItem: (_: string, value: string) => stored.push(value),
      getItem: () => null,
    });
    const { session } = await opened(protectedBoard());
    await session.submitToken(TOKEN);
    expect(stored).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("a connection the board closes", () => {
  it("says another page holds the board for status 1013", async () => {
    const board = networked();
    const session = new BoardSession();
    const transport = board.transport();
    transport.respond = () => {
      queueMicrotask(() => transport.drop(new ConnectionClosed(1013, "")));
      return [];
    };
    const done = session.connect(transport, "x");
    await settle();
    await done;
    expect(session.getState()).toMatchObject({ phase: "disconnected", error: CLOSE_MESSAGES[1013] });
  });

  it("opens the connection again by itself when it closes after network login is turned on", async () => {
    const board = networked();
    const { session, transports } = await opened(board);
    await session.setSettings({ network_login: true });
    await settle();
    expect(session.getState()).toMatchObject({ phase: "lost", auto: "reconnecting", error: null });
    await vi.advanceTimersByTimeAsync(1100);
    expect(transports).toHaveLength(2);
    expect(session.getState().phase).toBe("login");
  });
});

describe("the commands of the milestone", () => {
  it("forgets the WiFi network over USB and shows the new state", async () => {
    const board = networked();
    const { session } = await opened(board, "usb");
    await session.forgetWifi();
    expect(session.getState().wifi?.state).toBe("not_configured");
  });

  it("says USB is needed when the board answers usb_only", async () => {
    const { session } = await opened(networked(), "websocket");
    await session.forgetWifi();
    expect(session.getState().error).toBe("This works only with a USB cable.");
    expect(session.getState().phase).toBe("connected");
  });

  it("shows the token over USB and the new one after a regeneration", async () => {
    const { session } = await opened(networked(), "usb");
    expect(session.getState().settings?.token).toBe(TOKEN);
    await session.regenerateToken();
    expect(session.getState().settings?.token).toMatch(/^regenerated\d{5}$/);
  });

  it("does not show a token over WiFi", async () => {
    const { session } = await opened(networked(), "websocket");
    expect(session.getState().settings?.token).toBeUndefined();
  });

  it("starts a check and an install, and shows the update the board answers with", async () => {
    const board = networked((fake) => {
      fake.update = { ...fake.update, available: "9.9.9", last_result: "available" };
    });
    const { session } = await opened(board);
    await session.checkUpdate();
    expect(session.getState().update?.state).toBe("checking");
    board.update = { ...board.update, state: "idle", target: null };
    await session.installUpdate(false);
    expect(board.requests.at(-1)).toMatchObject({ cmd: "update_install", target: "firmware" });
    expect(board.requests.at(-1)).not.toHaveProperty("force");
    expect(session.getState().update).toMatchObject({ state: "downloading", progress: 0 });
  });

  it("sends force only when asked", async () => {
    const board = networked((fake) => {
      fake.update = { ...fake.update, available: "9.9.9", last_result: "skipped", skipped: "9.9.9" };
    });
    const { session } = await opened(board);
    await session.installUpdate(false);
    expect(session.getState().error).toContain("no update to install");
    await session.installUpdate(true);
    expect(board.requests.at(-1)).toMatchObject({ cmd: "update_install", target: "firmware", force: true });
  });

  it.each([
    ["updates_off", "turned off"],
    ["no_network", "not connected to WiFi"],
    ["nothing_to_install", "no update to install"],
    ["busy", "busy"],
  ])("explains %s in plain words", async (code, words) => {
    const board = networked((fake) => fake.errors.set("update_check", code));
    const { session } = await opened(board);
    await session.checkUpdate();
    expect(session.getState().error).toContain(words);
  });
});

describe("a board that restarts", () => {
  it("shows that it is restarting and connects again by itself", async () => {
    const board = networked((fake) => {
      fake.update = { ...fake.update, state: "restarting" };
    });
    const { session, transports } = await opened(board);
    transports[0]?.drop();
    await settle();
    expect(session.getState()).toMatchObject({ phase: "lost", auto: "restarting", error: null });
    await vi.advanceTimersByTimeAsync(11);
    expect(transports).toHaveLength(2);
    expect(session.getState()).toMatchObject({ phase: "connected", auto: null });
  });

  it("tries a bounded number of times, then says so and offers Reconnect", async () => {
    const board = networked((fake) => {
      fake.update = { ...fake.update, state: "restarting" };
    });
    const { session, transports } = await opened(board);
    let tries = 0;
    const reopener = session as unknown as { reopener: { opener: () => Promise<never> } };
    reopener.reopener.opener = () => {
      tries++;
      return Promise.reject(new Error("down"));
    };
    transports[0]?.drop();
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    expect(tries).toBe(5);
    expect(session.getState()).toMatchObject({ phase: "lost", auto: null });
    expect(session.getState().error).toContain("did not come back");
  });

  it("stops trying when the person disconnects", async () => {
    const board = networked((fake) => {
      fake.update = { ...fake.update, state: "downloading", progress: 90 };
    });
    const { session, transports } = await opened(board);
    transports[0]?.drop();
    await settle();
    await session.disconnect();
    await vi.advanceTimersByTimeAsync(200);
    expect(transports).toHaveLength(1);
    expect(session.getState().phase).toBe("disconnected");
  });

  it("does not reconnect by itself after an ordinary loss", async () => {
    const { session, transports } = await opened(networked());
    transports[0]?.drop();
    await settle();
    expect(session.getState()).toMatchObject({ phase: "lost", auto: null });
    await vi.advanceTimersByTimeAsync(200);
    expect(transports).toHaveLength(1);
  });
});

describe("the app on Zenit", () => {
  it("installs a new version of the app with target web", async () => {
    const board = networked((fake) => {
      fake.update = { ...fake.update, web: { ...UPDATE_STATUS.web, available: "1.1.0", last_result: "available" } };
    });
    const { session } = await opened(board);
    await session.installWebUpdate();
    expect(board.requests.at(-1)).toEqual({ seq: expect.any(Number), cmd: "update_install", target: "web" });
    expect(session.getState().update).toMatchObject({ state: "downloading", target: "web" });
  });

  it("loads the page again when the board that served it closes with 1012", async () => {
    const board = networked();
    const reload = vi.fn();
    const session = new BoardSession(null, { retryMs: 10, reload });
    session.setServed({ hostname: "zenit-a1b2" });
    const transport = board.transport();
    const done = session.connect(transport, "zenit-a1b2.local");
    await settle();
    await done;
    transport.drop(new ConnectionClosed(1012, ""));
    await settle();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("connects again, without loading the page, when it was not served by the board", async () => {
    const board = networked();
    const reload = vi.fn();
    const { session, transports } = await opened(board, "websocket", { reload });
    transports[0]?.drop(new ConnectionClosed(1012, ""));
    await settle();
    expect(reload).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ phase: "lost", auto: "reconnecting", error: null });
    await vi.advanceTimersByTimeAsync(1100);
    expect(transports).toHaveLength(2);
    expect(session.getState().phase).toBe("connected");
  });
});

describe("a page served by a board", () => {
  it("knows while it asks, and what it learns", () => {
    const session = new BoardSession();
    session.beginProbe();
    expect(session.getState().probing).toBe(true);
    session.setServed({ hostname: "zenit-a1b2" });
    expect(session.getState()).toMatchObject({ probing: false, served: { hostname: "zenit-a1b2" } });
  });

  it("keeps what it learned through a connection and a disconnection", async () => {
    const board = networked();
    const session = new BoardSession(null, { retryMs: 10 });
    session.setServed({ hostname: "zenit-a1b2" });
    const done = session.connect(board.transport(), "zenit-a1b2.local");
    await settle();
    await done;
    expect(session.getState().served).toEqual({ hostname: "zenit-a1b2" });
    await session.disconnect();
    expect(session.getState().served).toEqual({ hostname: "zenit-a1b2" });
  });
});
