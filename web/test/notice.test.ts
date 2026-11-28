// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { message } from "../src/i18n";
import { clearNotice, currentNotice, NOTICE_MS, showNotice } from "../src/ui/notice";

const first = message("errors:unknown");
const second = message("errors:noAnswer");

// The store is read through a hook; its listeners are what the test watches
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  clearNotice();
  vi.useRealTimers();
});

describe("notice", () => {
  it("is replaced by the next one, which starts its own time, and goes after NOTICE_MS", () => {
    showNotice(first);
    vi.advanceTimersByTime(NOTICE_MS - 1);
    showNotice(second);
    vi.advanceTimersByTime(NOTICE_MS - 1);
    // the first one's timer would have cleared it by now
    expect(currentNotice()).toBe(second);
    vi.advanceTimersByTime(1);
    expect(currentNotice()).toBeNull();
  });

  it("is cleared at once by clearNotice, with no timer left", () => {
    showNotice(first);
    clearNotice();
    expect(currentNotice()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
