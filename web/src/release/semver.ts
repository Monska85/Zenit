// SPDX-License-Identifier: GPL-3.0-or-later

// Semantic version precedence (semver.org, rule 11), for the firmware versions of docs/protocol/protocol-v1.md#firmware-version.

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** The dot-separated parts after `-`; empty for a release. */
  pre: string[];
}

const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** The version in `text`, or null when it is not a semantic version. Build metadata after `+` is ignored. */
export function parseVersion(text: string): Version | null {
  const match = SEMVER.exec(text);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] === undefined ? [] : match[4].split("."),
  };
}

const NUMERIC = /^[0-9]+$/;

/** Negative, zero or positive as `a` is older than, equal to or newer than `b`. */
export function compareVersions(a: Version, b: Version): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  // A release is newer than any pre-release of the same version.
  if (a.pre.length === 0 || b.pre.length === 0) return a.pre.length === b.pre.length ? 0 : a.pre.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i] as string;
    const y = b.pre[i] as string;
    if (x === y) continue;
    const xn = NUMERIC.test(x);
    const yn = NUMERIC.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return Math.sign(a.pre.length - b.pre.length);
}
