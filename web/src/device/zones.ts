// SPDX-License-Identifier: GPL-3.0-or-later

// The IANA time zones the app offers, each with the POSIX TZ string the board takes (docs/web/web-app-v1.md#board-settings).
// zones.json is made by tools/tz_table.py from the tz database (public domain), never by hand. Only the Device page
// imports this module, so the table loads with that page.

import table from "./zones.json";

export interface Zone {
  /** The IANA name, such as "Asia/Kolkata". */
  name: string;
  /** The POSIX TZ string the board takes, the footer of the zone's TZif file. */
  posix: string;
  /** The ISO 3166 code of its country, or "" (Etc/UTC, Etc/GMT+5...). */
  country: string;
  /** The last part of the name, with spaces: "Buenos Aires". */
  city: string;
  /** What the app calls it: "Kolkata (India)", "Singapore", "UTC", or the IANA name when it has no country. */
  label: string;
}

/** The table as tools/tz_table.py writes it. */
export interface ZoneData {
  zones: string[][];
  aliases: Record<string, string>;
  countries: Record<string, string>;
}

/** The English name of a country: the browser's own when it has one, else `fallback` (the tz database's). */
function countryName(code: string, fallback: string | undefined): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    if (name && name !== code) return name;
  } catch {
    // An old browser without Intl.DisplayNames
  }
  return fallback ?? code;
}

function cityOf(name: string): string {
  return (name.split("/").pop() ?? name).replaceAll("_", " ");
}

interface SearchEntry {
  zone: Zone;
  /** The city, then the cities of its aliases ("calcutta" for Kolkata). */
  cities: string[];
  /** The country's names: the browser's and the tz database's. */
  countries: string[];
  /** The whole IANA name. */
  full: string;
}

/** Whether a word of `text` starts with `query`; both are normalized, so words are split by single spaces. */
const startsWord = (text: string, query: string): boolean => text.startsWith(query) || text.includes(` ${query}`);

/** How well a zone matches a normalized query, lower is better, or null when it does not. */
function rank(entry: SearchEntry, query: string): number | null {
  if (entry.cities[0] === query || entry.countries.includes(query)) return 0;
  if (entry.cities[0]?.startsWith(query)) return 1;
  if (entry.cities.some((city) => startsWord(city, query))) return 2;
  if (entry.countries.some((name) => name.startsWith(query))) return 3;
  if (entry.countries.some((name) => startsWord(name, query))) return 4;
  if (entry.full.includes(query)) return 5;
  return null;
}

/** The longest list of suggestions. */
export const SEARCH_LIMIT = 8;

/** The lookups of a table: the app's is `ZONE_TABLE`; the tests make their own from a fixture. */
export function zoneTable(data: ZoneData) {
  const labelOf = (name: string, city: string, country: string): string => {
    if (name === "Etc/UTC") return "UTC";
    if (country === "") return name;
    const place = countryName(country, data.countries[country]);
    return place === city ? city : `${city} (${place})`;
  };

  /** Every zone, in the table's order: the first zone of a POSIX string is the one a board's zone is named by. */
  const zones: readonly Zone[] = data.zones.map(([name = "", posix = "", country = ""]) => {
    const city = cityOf(name);
    return { name, posix, country, city, label: labelOf(name, city, country) };
  });
  const byName = new Map(zones.map((zone) => [zone.name, zone]));

  /** The zone of an IANA name, following aliases (Asia/Calcutta is Asia/Kolkata), or null when the table has none. */
  function zoneByName(name: string | null | undefined): Zone | null {
    if (!name) return null;
    return byName.get(name) ?? byName.get(data.aliases[name] ?? "") ?? null;
  }

  /**
   * The zone a board's POSIX string is shown as. Zones with the same string are the same for the board, so the first
   * that has it of: the zone chosen on this page, this browser's zone, the table in its order. Null when no zone has
   * it: the app then shows the string itself.
   */
  function boardZone(posix: string, chosen: string | null, browser: string | null): Zone | null {
    for (const zone of [zoneByName(chosen), zoneByName(browser)]) if (zone?.posix === posix) return zone;
    return zones.find((zone) => zone.posix === posix) ?? null;
  }

  /** The browser's zone to offer when its POSIX string is not the board's, or null (unknown zone, or the same string). */
  function browserOffer(boardPosix: string, browser: string | null): Zone | null {
    const zone = zoneByName(browser);
    return zone !== null && zone.posix !== boardPosix ? zone : null;
  }

  let entries: SearchEntry[] | null = null;
  /** The zones a search looks at: those with a country, and UTC. Built at the first search. */
  function searchEntries(): SearchEntry[] {
    if (entries !== null) return entries;
    const aliasCities = new Map<string, string[]>();
    for (const [alias, target] of Object.entries(data.aliases)) {
      aliasCities.set(target, [...(aliasCities.get(target) ?? []), normalize(cityOf(alias))]);
    }
    entries = zones
      .filter((zone) => zone.country !== "" || zone.name === "Etc/UTC")
      .map((zone) => {
        const own = normalize(zone.name === "Etc/UTC" ? "UTC" : zone.city);
        const others = (aliasCities.get(zone.name) ?? []).filter((city) => city !== own);
        const names =
          zone.country === ""
            ? []
            : [countryName(zone.country, data.countries[zone.country]), data.countries[zone.country] ?? ""];
        const countries = [...new Set(names.map(normalize))].filter((name) => name !== "");
        return { zone, cities: [own, ...others], countries, full: normalize(zone.name) };
      });
    return entries;
  }

  /** The zones that match what was typed, best first (the exact city or country, then a city, then a country, then the
   * IANA name; ties by label). */
  function searchZones(text: string, limit = SEARCH_LIMIT): Zone[] {
    const query = normalize(text);
    if (query === "") return [];
    const found: Array<{ zone: Zone; rank: number }> = [];
    for (const entry of searchEntries()) {
      const score = rank(entry, query);
      if (score !== null) found.push({ zone: entry.zone, rank: score });
    }
    found.sort((a, b) => a.rank - b.rank || a.zone.label.localeCompare(b.zone.label, "en"));
    return found.slice(0, limit).map((item) => item.zone);
  }

  return { zones, zoneByName, boardZone, browserOffer, searchZones };
}

/** The app's table. */
export const ZONE_TABLE = zoneTable(table);

/** The text of a search: lower case, no accents, `_`, `/` and `-` as spaces. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_/\-.,()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
