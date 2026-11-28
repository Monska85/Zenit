// SPDX-License-Identifier: GPL-3.0-or-later

// The time zone lookups of the Device page (docs/web/web-app-v1.md#board-settings), on a fixture table shaped like the
// one tools/tz_table.py writes. tools/test_tz_table.py checks the real table against the pinned tz database.

import { describe, expect, it } from "vitest";
import { timezoneProblem } from "../src/device/settings";
import { normalize, SEARCH_LIMIT, ZONE_TABLE, zoneTable } from "../src/device/zones";

const CET = "CET-1CEST,M3.5.0,M10.5.0/3";
const FIXTURE = zoneTable({
  zones: [
    ["Europe/Berlin", CET, "DE"],
    ["Europe/Rome", CET, "IT"],
    ["Asia/Kolkata", "IST-5:30", "IN"],
    ["America/Sao_Paulo", "<-03>3", "BR"],
    ["America/Argentina/Buenos_Aires", "<-03>3", "AR"],
    ["Asia/Singapore", "<+08>-8", "SG"],
    ["Europe/London", "GMT0BST,M3.5.0/1,M10.5.0", "GB"],
    ["America/Indiana/Indianapolis", "EST5EDT,M3.2.0,M11.1.0", "US"],
    ["America/New_York", "EST5EDT,M3.2.0,M11.1.0", "US"],
    ["Europe/Zurich", CET, "CH"],
    ["Etc/UTC", "UTC0", ""],
    ["Etc/GMT+5", "<-05>5", ""],
  ],
  aliases: { "Asia/Calcutta": "Asia/Kolkata", UTC: "Etc/UTC", "US/Eastern": "America/New_York" },
  countries: {
    AR: "Argentina",
    BR: "Brazil",
    CH: "Switzerland",
    DE: "Germany",
    GB: "Britain (UK)",
    IN: "India",
    IT: "Italy",
    SG: "Singapore",
    US: "United States",
  },
});

describe("zoneTable", () => {
  it("names a zone by its city and country, and Etc/UTC as UTC", () => {
    const label = (name: string) => FIXTURE.zoneByName(name)?.label;
    expect(label("Asia/Kolkata")).toBe("Kolkata (India)");
    expect(label("America/Argentina/Buenos_Aires")).toBe("Buenos Aires (Argentina)");
    expect(label("Europe/London")).toBe("London (United Kingdom)");
    // A city that is its country is named once
    expect(label("Asia/Singapore")).toBe("Singapore");
    expect(label("Etc/UTC")).toBe("UTC");
    expect(label("Etc/GMT+5")).toBe("Etc/GMT+5");
  });

  it("follows aliases, and knows nothing else", () => {
    expect(FIXTURE.zoneByName("Asia/Calcutta")?.name).toBe("Asia/Kolkata");
    expect(FIXTURE.zoneByName("UTC")?.posix).toBe("UTC0");
    expect(FIXTURE.zoneByName("Mars/Olympus")).toBeNull();
    expect(FIXTURE.zoneByName("")).toBeNull();
    expect(FIXTURE.zoneByName(null)).toBeNull();
  });
});

describe("boardZone", () => {
  it("names the board's string by the zone chosen here, then this browser's, then the table's first", () => {
    expect(FIXTURE.boardZone(CET, "Europe/Zurich", "Europe/Rome")?.name).toBe("Europe/Zurich");
    expect(FIXTURE.boardZone(CET, null, "Europe/Rome")?.name).toBe("Europe/Rome");
    expect(FIXTURE.boardZone(CET, null, null)?.name).toBe("Europe/Berlin");
    // A chosen or browser zone with another string does not name it
    expect(FIXTURE.boardZone(CET, "Asia/Kolkata", "America/New_York")?.name).toBe("Europe/Berlin");
    // An alias of the browser names it by its zone
    expect(FIXTURE.boardZone("IST-5:30", null, "Asia/Calcutta")?.name).toBe("Asia/Kolkata");
  });

  it("names nothing when no zone has the string", () => {
    expect(FIXTURE.boardZone("XYZ-5", "Europe/Rome", "Europe/Rome")).toBeNull();
  });
});

describe("browserOffer", () => {
  it("offers the browser's zone when its string differs from the board's", () => {
    expect(FIXTURE.browserOffer("UTC0", "Asia/Kolkata")?.name).toBe("Asia/Kolkata");
    expect(FIXTURE.browserOffer("UTC0", "Asia/Calcutta")?.label).toBe("Kolkata (India)");
    expect(FIXTURE.browserOffer("XYZ-5", "America/Sao_Paulo")?.posix).toBe("<-03>3");
  });

  it("offers nothing for the same string, whatever the zone's name", () => {
    expect(FIXTURE.browserOffer(CET, "Europe/Rome")).toBeNull();
    // Buenos Aires and Sao Paulo have the same rule: the board cannot tell them apart
    expect(FIXTURE.browserOffer("<-03>3", "America/Argentina/Buenos_Aires")).toBeNull();
  });

  it("offers nothing for a zone the table does not have, or none", () => {
    expect(FIXTURE.browserOffer("UTC0", "Mars/Olympus")).toBeNull();
    expect(FIXTURE.browserOffer("UTC0", null)).toBeNull();
  });
});

describe("searchZones", () => {
  const names = (text: string) => FIXTURE.searchZones(text).map((zone) => zone.name);

  it("finds a city by its start, ignoring case, accents and underscores", () => {
    expect(names("rome")).toEqual(["Europe/Rome"]);
    expect(names("São")).toEqual(["America/Sao_Paulo"]);
    expect(names("buenos ai")).toEqual(["America/Argentina/Buenos_Aires"]);
    expect(names("  KOLK ")).toEqual(["Asia/Kolkata"]);
  });

  it("ranks the exact city or country first", () => {
    // "india" is the start of Indianapolis, and the whole name of India
    expect(names("india")).toEqual(["Asia/Kolkata", "America/Indiana/Indianapolis"]);
    expect(names("singapore")).toEqual(["Asia/Singapore"]);
  });

  it("ranks a city before a word of a city, a country, a word of a country and the IANA name", () => {
    // "ind": a city that starts with it, then India (a country), then the IANA name America/Indiana/...
    expect(names("ind")).toEqual(["America/Indiana/Indianapolis", "Asia/Kolkata"]);
    expect(names("york")).toEqual(["America/New_York"]);
    // "united": a country's start (United Kingdom, United States), ties by label
    expect(names("united")).toEqual(["America/Indiana/Indianapolis", "Europe/London", "America/New_York"]);
    // A word inside the tz database's country name: "Britain (UK)"
    expect(names("uk")).toEqual(["Europe/London"]);
    expect(names("argentina")).toEqual(["America/Argentina/Buenos_Aires"]);
  });

  it("finds a zone by the city of an alias", () => {
    expect(names("calcutta")).toEqual(["Asia/Kolkata"]);
    expect(names("eastern")).toEqual(["America/New_York"]);
  });

  it("offers UTC and leaves out the zones without a country", () => {
    expect(names("utc")).toEqual(["Etc/UTC"]);
    expect(names("gmt")).toEqual([]);
  });

  it("finds nothing for nothing, and stops at the limit", () => {
    expect(names("")).toEqual([]);
    expect(names("   ")).toEqual([]);
    expect(names("zzz")).toEqual([]);
    expect(FIXTURE.searchZones("e", 3)).toHaveLength(3);
    expect(SEARCH_LIMIT).toBe(8);
    expect(ZONE_TABLE.searchZones("a").length).toBe(SEARCH_LIMIT);
  });
});

describe("normalize", () => {
  it("compares text the way a person types it", () => {
    expect(normalize("  Ciudad_Juárez ")).toBe("ciudad juarez");
    expect(normalize("America/Port-au-Prince")).toBe("america port au prince");
    expect(normalize("Britain (UK)")).toBe("britain uk");
  });
});

describe("ZONE_TABLE", () => {
  it("holds only strings the board accepts, and every name once", () => {
    for (const zone of ZONE_TABLE.zones) expect(timezoneProblem(zone.posix), zone.name).toBeNull();
    expect(new Set(ZONE_TABLE.zones.map((zone) => zone.name)).size).toBe(ZONE_TABLE.zones.length);
  });

  it("gives every zone a search finds its own label", () => {
    const labels = ZONE_TABLE.zones.filter((zone) => zone.country !== "").map((zone) => zone.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
