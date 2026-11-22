// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { describeError } from "../src/board/messages";
import { BoardError, ClientError } from "../src/protocol/client";
import { routeOf } from "../src/ui/route";
import { timerLine } from "../src/ui/light/timer-card";

describe("routeOf", () => {
  it("reads the view from the fragment, and falls back to the Light view", () => {
    expect(routeOf("#/device")).toBe("device");
    expect(routeOf("#/privacy")).toBe("privacy");
    expect(routeOf("#/connect")).toBe("connect");
    expect(routeOf("#/light")).toBe("light");
    expect(routeOf("#device")).toBe("device");
    expect(routeOf("")).toBe("light");
    expect(routeOf("#/nowhere")).toBe("light");
    expect(routeOf("#/device/extra")).toBe("light");
  });
});

describe("describeError", () => {
  it("has a sentence for each error code of the specification the app can meet", () => {
    for (const code of ["bad_request", "unknown_command", "storage_error", "usb_only", "busy"]) {
      expect(describeError(new BoardError(code, "for logs"))).toMatch(/\.$/);
      expect(describeError(new BoardError(code, "for logs"))).not.toContain("for logs");
    }
  });

  it("names an unknown code", () => {
    expect(describeError(new BoardError("new_thing", "x"))).toBe("Zenit refused the request (new_thing).");
  });

  it("says Zenit did not answer when no reply came", () => {
    expect(describeError(new ClientError("no_reply", "x"))).toContain("did not answer");
    expect(describeError(new ClientError("closed", "x"))).toContain("did not answer");
    expect(describeError(new Error("x"))).toBe("Something went wrong.");
  });
});

describe("timerLine", () => {
  const light = (overrides: Record<string, unknown>) => ({
    on: true,
    effect: "static",
    color: "white" as string | null,
    lightness: 60,
    power_scale: 100,
    timer: { minutes: 30, remaining: 1754 } as { minutes: number; remaining: number } | null,
    ...overrides,
  });

  it("shows the time left while the light is on", () => {
    expect(timerLine(light({}))).toBe("Fades out in 29 min.");
    expect(timerLine(light({ timer: { minutes: 90, remaining: 4320 } }))).toBe("Fades out in 1 h 12 min.");
    expect(timerLine(light({ timer: { minutes: 1, remaining: 45 } }))).toBe("Fades out in 45 s.");
  });

  it("says nothing without a timer, or while the light is off with time left", () => {
    expect(timerLine(light({ timer: null }))).toBeNull();
    expect(timerLine(light({ on: false }))).toBeNull();
  });

  it("says the timer ended, and the light stays off", () => {
    expect(timerLine(light({ on: false, timer: { minutes: 30, remaining: 0 } }))).toContain("The timer ended.");
  });
});
