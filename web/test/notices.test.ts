// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { licenseAllowed, renderNotices, type BundledPackage } from "../scripts/notices.ts";
import { repositoryFromSlug, repositoryUrl } from "../scripts/repository.ts";

const pkg = (overrides: Partial<BundledPackage>): BundledPackage => ({
  name: "left-pad",
  version: "1.0.0",
  license: "MIT",
  licenseText: "MIT text",
  noticeText: null,
  repository: "git+https://example.org/left-pad.git",
  homepage: null,
  ...overrides,
});

describe("licenseAllowed", () => {
  it.each([
    "MIT",
    "ISC",
    "Apache-2.0",
    "BSD-3-Clause",
    "(MIT OR GPL-3.0-only)",
    "MIT AND Zlib",
    "LGPL-2.1-or-later",
    "GPL-3.0-or-later",
  ])("allows %s", (license) => expect(licenseAllowed(license)).toBe(true));

  it.each([
    null,
    undefined,
    "",
    "UNLICENSED",
    "GPL-2.0-only",
    "AGPL-3.0-only",
    "SSPL-1.0",
    "MIT AND CC-BY-NC-4.0",
    "MIT WITH Exception",
    "Proprietary",
  ])("refuses %s", (license) => expect(licenseAllowed(license)).toBe(false));
});

describe("renderNotices", () => {
  const read = (file: string): string => `text of ${file}`;

  it("lists the fixed entries and each package once, with its license text", () => {
    const text = renderNotices(
      [pkg({}), pkg({ name: "a-lib", licenseText: "MIT text" })],
      "https://github.com/o/r",
      read,
    );
    expect(text).toContain("Zenit web app: third-party notices");
    expect(text).toContain("https://github.com/o/r.");
    expect(text).toContain("shadcn/ui");
    expect(text).toContain("esptool flasher stubs");
    expect(text).toContain("a-lib");
    expect(text).toContain("left-pad");
    expect(text).toContain("Source: https://example.org/left-pad");
    expect(text.match(/MIT text/g)).toHaveLength(1);
  });

  it("fails on a package with no license text", () => {
    expect(() => renderNotices([pkg({ licenseText: null })], undefined, read)).toThrow("no license text");
    expect(() => renderNotices([pkg({ licenseText: "  " })], undefined, read)).toThrow("left-pad@1.0.0");
  });

  it("prints a notice file next to the license", () => {
    expect(renderNotices([pkg({ noticeText: "NOTICE body" })], undefined, read)).toContain("NOTICE body");
  });
});

describe("repositoryUrl", () => {
  it("is the project's repository for a local build", () => {
    expect(repositoryUrl({})).toBe("https://github.com/Monska85/Zenit");
    expect(repositoryUrl({ GITHUB_REPOSITORY: "a/b" })).toBe("https://github.com/Monska85/Zenit");
  });

  it("is the repository of the workflow in GitHub Actions", () => {
    expect(repositoryUrl({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "someone/zenit-fork" })).toBe(
      "https://github.com/someone/zenit-fork",
    );
    expect(repositoryUrl({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "" })).toBe("https://github.com/Monska85/Zenit");
  });

  it.each(["", "a", "a/b/c", "a/..", "-a/b", "a/b c", "a/b?x=1"])("refuses %j", (slug) => {
    expect(() => repositoryFromSlug(slug)).toThrow();
  });
});
