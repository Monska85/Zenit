// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { firmwareState, readManifest } from "../src/release/manifest";
import { compareVersions, parseVersion } from "../src/release/semver";

const order = (a: string, b: string): number =>
  compareVersions(
    parseVersion(a) as NonNullable<ReturnType<typeof parseVersion>>,
    parseVersion(b) as NonNullable<ReturnType<typeof parseVersion>>,
  );

describe("parseVersion", () => {
  it("reads the forms of docs/protocol/protocol-v1.md#firmware-version", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion("0.1.0-dev.3+gabc1234")).toEqual({ major: 0, minor: 1, patch: 0, pre: ["dev", "3"] });
    expect(parseVersion("0.1.0-dev.3+gabc1234.dirty")?.pre).toEqual(["dev", "3"]);
    expect(parseVersion("0.0.0-unknown")?.pre).toEqual(["unknown"]);
  });

  it.each(["", "1", "1.2", "1.2.3.4", "01.2.3", "1.2.3-", "1.2.3-01", "v1.2.3", "1.2.3+", "a.b.c", "1.2.3 "])(
    "refuses %j",
    (text) => {
      expect(parseVersion(text)).toBeNull();
    },
  );
});

describe("compareVersions (the examples of semver.org)", () => {
  it("orders the precedence chain", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "1.0.1",
      "1.1.0",
      "2.0.0",
    ];
    for (let i = 0; i < chain.length; i++) {
      for (let j = 0; j < chain.length; j++) {
        expect(Math.sign(order(chain[i] as string, chain[j] as string)), `${chain[i]} ${chain[j]}`).toBe(
          Math.sign(i - j),
        );
      }
    }
  });

  it("ignores build metadata", () => {
    expect(order("1.0.0+a", "1.0.0+b")).toBe(0);
  });

  it("compares numbers as numbers", () => {
    expect(order("1.10.0", "1.9.0")).toBeGreaterThan(0);
  });
});

describe("firmwareState", () => {
  it("says what a board's version is against the published one", () => {
    expect(firmwareState("1.0.0", "1.0.0")).toBe("up_to_date");
    expect(firmwareState("1.0.0", "1.1.0")).toBe("update_available");
    expect(firmwareState("1.2.0", "1.1.0")).toBe("newer");
    expect(firmwareState("1.0.0-dev.3+gabc", "1.0.0")).toBe("update_available");
    expect(firmwareState("1.1.0-dev.3+gabc.dirty", "1.0.0")).toBe("newer");
    expect(firmwareState("0.0.0-unknown", "0.1.0")).toBe("update_available");
  });

  it("does not compare what it cannot read", () => {
    expect(firmwareState("local build", "1.0.0")).toBe("unknown");
    expect(firmwareState("1.0.0", "x")).toBe("unknown");
  });
});

describe("readManifest", () => {
  const manifest = {
    name: "Zenit",
    version: "1.0.0",
    new_install_prompt_erase: false,
    builds: [{ chipFamily: "ESP32-C3", parts: [{ path: "zenit-esp32c3-factory.bin", offset: 0 }] }],
  };

  it("reads a Zenit manifest of an ESP32-C3", () => {
    expect(readManifest(manifest)).toEqual({ name: "Zenit", version: "1.0.0" });
  });

  it.each([
    ["null", null],
    ["text", "x"],
    ["another name", { ...manifest, name: "Other" }],
    ["no version", { ...manifest, version: undefined }],
    ["a version that is not semantic", { ...manifest, version: "latest" }],
    ["no builds", { ...manifest, builds: undefined }],
    ["another chip", { ...manifest, builds: [{ chipFamily: "ESP32" }] }],
    ["an empty list of builds", { ...manifest, builds: [] }],
  ])("refuses %s", (_name, value) => {
    expect(readManifest(value)).toBeNull();
  });
});
