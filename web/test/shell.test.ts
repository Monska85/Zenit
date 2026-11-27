// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { BoardSession, type BoardState } from "../src/board/session";
import { COLOR_SWATCHES, contrast, customTimerLabel, liveLine, swatchInk } from "../src/light/model";
import { boardName, pillState } from "../src/ui/shell/status-menu";
import { screenOf } from "../src/ui/route";
import { backAgainStep, type BackAgain } from "../src/ui/shell/use-back-again";

const base: BoardState = new BoardSession().getState();
const state = (patch: Partial<BoardState>): BoardState => ({ ...base, ...patch });

describe("swatchInk", () => {
  it("draws the power icon at 3:1 or more on every color the button can take", () => {
    for (const swatch of Object.values(COLOR_SWATCHES)) {
      expect(contrast(swatch, swatchInk(swatch))).toBeGreaterThanOrEqual(3);
    }
  });

  it("is dark on warm white and white on blue", () => {
    expect(swatchInk("#fff1cf")).toBe("#1a1208");
    expect(swatchInk("#2f6fe0")).toBe("#ffffff");
  });

  it("measures contrast the WCAG way", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("liveLine", () => {
  const light = { on: true, color: "white", effect: "static", timer: null };

  it("says nothing more than Off while the light is off", () => {
    expect(liveLine({ ...light, on: false })).toBeNull();
  });

  it("names the color and the effect", () => {
    expect(liveLine(light)).toEqual({ color: "Warm white", effect: "Steady", timer: null });
    expect(liveLine({ ...light, color: "red", effect: "twinkle" })).toEqual({
      color: "Red",
      effect: "Twinkle",
      timer: null,
    });
  });

  it("says when the timer fades it out, without counting seconds", () => {
    expect(liveLine({ ...light, timer: { remaining: 12 * 60 + 40 } })?.timer).toBe("fades out in 12 min");
    expect(liveLine({ ...light, timer: { remaining: 65 * 60 } })?.timer).toBe("fades out in 1 h 5 min");
    expect(liveLine({ ...light, timer: { remaining: 59 } })?.timer).toBe("fades out in less than a minute");
    expect(liveLine({ ...light, timer: { remaining: 60 } })?.timer).toBe("fades out in 1 min");
  });

  it("leaves out a timer that ended", () => {
    expect(liveLine({ ...light, timer: { remaining: 0 } })?.timer).toBeNull();
  });

  it("says On when no color is lit yet, and words an unknown effect", () => {
    expect(liveLine({ ...light, color: null })?.color).toBe("On");
    expect(liveLine({ ...light, effect: "aurora_glow" })?.effect).toBe("Aurora glow");
  });
});

describe("customTimerLabel", () => {
  it("is Custom for no timer and for a preset", () => {
    for (const minutes of [0, 15, 30, 60, 120]) expect(customTimerLabel(minutes)).toBe("Custom");
  });

  it("shows a custom value on the chip", () => {
    expect(customTimerLabel(45)).toBe("Custom · 45 min");
    expect(customTimerLabel(90)).toBe("Custom · 1 h 30 min");
    expect(customTimerLabel(360)).toBe("Custom · 6 h");
  });
});

describe("pillState", () => {
  it("words every phase", () => {
    expect(pillState(state({ phase: "disconnected" }))).toEqual({ text: "Not connected", dot: "off" });
    expect(pillState(state({ phase: "connecting" }))).toEqual({ text: "Connecting...", dot: "wait" });
    expect(pillState(state({ phase: "login" }))).toEqual({ text: "Log in needed", dot: "wait" });
    expect(pillState(state({ phase: "connected", kind: "websocket" }))).toEqual({ text: "WiFi", dot: "ok" });
    expect(pillState(state({ phase: "connected", kind: "usb" }))).toEqual({ text: "USB", dot: "ok" });
    expect(pillState(state({ phase: "lost", auto: null }))).toEqual({ text: "Not connected", dot: "off" });
    expect(pillState(state({ phase: "lost", auto: "restarting" }))).toEqual({ text: "Restarting...", dot: "wait" });
    expect(pillState(state({ phase: "lost", auto: "reconnecting" }))).toEqual({
      text: "Reconnecting...",
      dot: "wait",
    });
  });
});

describe("boardName", () => {
  const wifi = { state: "connected", ssid: null, rssi: null, ip: null, hostname: "zenit-a1b2" };

  it("takes the name of the board that served the page first, then its name on the network", () => {
    expect(boardName(state({}))).toBeNull();
    expect(boardName(state({ wifi }))).toBe("zenit-a1b2");
    expect(boardName(state({ wifi, served: { hostname: "zenit-c3d4" } }))).toBe("zenit-c3d4");
  });
});

describe("backAgainStep", () => {
  type Step = [BoardState["phase"], boolean];
  const run = (steps: Step[]): BackAgain =>
    steps.reduce<BackAgain>((current, [phase, opening]) => backAgainStep(current, phase, opening), {
      wasLost: false,
      shown: false,
    });

  it("confirms a lost connection that comes back by Reconnect", () => {
    const reconnect: Step[] = [
      ["connected", false],
      ["lost", false],
      ["disconnected", true],
      ["connecting", true],
      ["connected", false],
    ];
    expect(run(reconnect).shown).toBe(true);
  });

  it("confirms a connection that comes back by itself", () => {
    expect(
      run([
        ["connected", false],
        ["lost", false],
        ["connected", false],
      ]).shown,
    ).toBe(true);
  });

  it("says nothing for a first connection", () => {
    expect(
      run([
        ["connecting", true],
        ["connected", false],
      ]).shown,
    ).toBe(false);
  });

  it("forgets the loss after a Reconnect that failed, so the next board is not 'connected again'", () => {
    const failed: Step[] = [
      ["lost", false],
      ["disconnected", true],
      ["disconnected", false],
    ];
    expect(run([...failed, ["connecting", true], ["connected", false]]).shown).toBe(false);
  });

  it("forgets the loss after a Disconnect", () => {
    expect(
      run([
        ["lost", false],
        ["disconnected", false],
        ["connected", false],
      ]).shown,
    ).toBe(false);
  });

  it("keeps showing while the connection stays up, and hides when it is lost again", () => {
    const back = run([
      ["lost", false],
      ["connected", false],
    ]);
    expect(backAgainStep(back, "connected", true).shown).toBe(true);
    expect(backAgainStep(back, "lost", false).shown).toBe(false);
  });
});

describe("screenOf", () => {
  it("shows Privacy whatever the connection", () => {
    expect(screenOf("privacy", "login")).toBe("privacy");
    expect(screenOf("privacy", "connected")).toBe("privacy");
  });

  it("shows the login in place of the Light, Device and Connect views", () => {
    for (const route of ["light", "device", "connect"] as const) expect(screenOf(route, "login")).toBe("login");
  });

  it("makes the Light view the Connect screen without a connection, and keeps it while the connection is lost", () => {
    expect(screenOf("light", "disconnected")).toBe("connect");
    expect(screenOf("light", "connecting")).toBe("connect");
    expect(screenOf("light", "lost")).toBe("light");
    expect(screenOf("light", "connected")).toBe("light");
    expect(screenOf("connect", "connected")).toBe("connect");
  });

  it("shows Device in every phase but the login", () => {
    for (const phase of ["disconnected", "connecting", "connected", "lost"] as const)
      expect(screenOf("device", phase)).toBe("device");
  });
});
