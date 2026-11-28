// SPDX-License-Identifier: GPL-3.0-or-later

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { ZONE_TABLE, type Zone } from "../../device/zones";
import { zoneSearchKey, type ListState } from "./zone-search-keys";
import { cn } from "../../lib/utils";
import { useBoard } from "../board-context";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import { useCommit } from "../light/use-commit";

/** This browser's IANA time zone, or null when it does not say. Read in the page only; it is never stored or sent. */
export function browserZoneName(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** The board's time zone in words: its zone's name, or the POSIX string itself when no zone has it. */
export function zoneText(posix: string, chosen: string | null): string {
  return ZONE_TABLE.boardZone(posix, chosen, browserZoneName())?.label ?? posix;
}

/**
 * The offer of this device's time zone, first on the Device page, while the board's POSIX string is not the one of the
 * browser's zone. `onChoose` remembers the zone chosen on this page, so the board's string is named by it.
 */
export function TimeZoneOffer({ chosen, onChoose }: { chosen: string | null; onChoose: (name: string) => void }) {
  const { board } = useBoard();
  const { pending, commit } = useCommit();
  const settings = board.settings && { ...board.settings, ...pending };
  if (!settings || settings.timezone === undefined || board.phase !== "connected") return null;
  const posix = settings.timezone;
  const mine = ZONE_TABLE.browserOffer(posix, browserZoneName());
  if (mine === null) return null;
  const now = ZONE_TABLE.boardZone(posix, chosen, null);
  return (
    <Card aria-labelledby="time-offer-title" data-testid="time-zone-offer">
      <CardTitle id="time-offer-title">Time zone</CardTitle>
      <p className="mb-3 text-base">
        {now === null ? `Zenit uses the time zone ${posix}.` : `Zenit uses ${now.label} time.`}
      </p>
      <Button
        variant="outline"
        onClick={() => {
          onChoose(mine.name);
          void commit({ timezone: mine.posix });
        }}
      >
        Use this device's time zone ({mine.city})
      </Button>
    </Card>
  );
}

/**
 * A search field that suggests time zones by city, country or IANA name (a combobox with a list of options). Choosing
 * one calls `onChoose` at once and empties the field.
 */
export function ZoneSearch({ onChoose }: { onChoose: (zone: Zone) => void }) {
  const [text, setText] = useState("");
  const [list, setList] = useState<ListState>({ open: false, active: -1 });
  const found = useMemo(() => ZONE_TABLE.searchZones(text), [text]);
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const typed = text.trim() !== "";
  const shown = list.open && found.length > 0;

  function choose(zone: Zone): void {
    onChoose(zone);
    setText("");
    setList({ open: false, active: -1 });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const result = zoneSearchKey(list, event.key, found.length);
    if (result.handled) event.preventDefault();
    setList(result.state);
    const active = found[list.active];
    if (result.action === "choose" && active) choose(active);
    if (result.action === "clear") setText("");
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-base font-medium">
        Find a time zone
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && list.active >= 0 ? optionId(list.active) : undefined}
        aria-describedby={hintId}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setList({ open: true, active: -1 });
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setList({ open: false, active: -1 })}
        className="block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
      />
      <p id={hintId} className="mt-1 text-sm text-muted-foreground">
        Type a city or a country, then choose. Zenit changes at once.
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label="Time zones"
        hidden={!shown}
        className="mt-2 flex flex-col overflow-hidden rounded-xl border border-border bg-background"
      >
        {shown &&
          found.map((zone, index) => (
            <li
              key={zone.name}
              id={optionId(index)}
              role="option"
              aria-selected={index === list.active}
              // Keep the focus in the field, so the list stays open until the click chooses
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(zone)}
              className={cn(
                "flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1.5 text-base hover:bg-muted",
                index === list.active && "bg-muted outline-2 -outline-offset-2 outline-primary",
              )}
            >
              <span>{zone.label}</span>
              <span className="text-sm text-muted-foreground">{zone.name}</span>
            </li>
          ))}
      </ul>
      <p role="status" className="mt-1 text-sm text-muted-foreground empty:hidden">
        {typed && list.open && found.length === 0 ? "No time zone matches. Try a nearby city or the country." : ""}
        {shown ? <span className="sr-only">{`${found.length} time zones found.`}</span> : ""}
      </p>
    </div>
  );
}
