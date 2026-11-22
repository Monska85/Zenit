// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { CommitTracker } from "../src/ui/light/commit-tracker";

describe("CommitTracker", () => {
  it("lets a lone commit clear its settings, once", () => {
    const tracker = new CommitTracker();
    const finish = tracker.start(["effect", "color"]);
    expect(finish()).toEqual(["effect", "color"]);
    expect(finish()).toEqual([]);
  });

  it("does not let an earlier commit that ends late clear a setting a later one is still showing", () => {
    const tracker = new CommitTracker();
    const first = tracker.start(["effect"]);
    const second = tracker.start(["effect"]);
    // The delayed first reply comes back while the second commit is in flight
    expect(first()).toEqual([]);
    expect(second()).toEqual(["effect"]);
  });

  it("lets the earlier one clear what the later one did not take over", () => {
    const tracker = new CommitTracker();
    const first = tracker.start(["effect", "floor"]);
    const second = tracker.start(["effect"]);
    expect(first()).toEqual(["floor"]);
    expect(second()).toEqual(["effect"]);
  });

  it("does not let a late ending commit clear a setting that was committed again after it ended", () => {
    const tracker = new CommitTracker();
    const first = tracker.start(["floor"]);
    expect(first()).toEqual(["floor"]);
    const second = tracker.start(["floor"]);
    expect(first()).toEqual([]);
    expect(second()).toEqual(["floor"]);
  });

  it("keeps settings apart", () => {
    const tracker = new CommitTracker();
    const brightness = tracker.start(["brightness"]);
    const effect = tracker.start(["effect"]);
    expect(brightness()).toEqual(["brightness"]);
    expect(effect()).toEqual(["effect"]);
  });
});
