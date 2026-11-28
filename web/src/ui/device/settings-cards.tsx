// SPDX-License-Identifier: GPL-3.0-or-later

import { own } from "../../lib/own";
import { Copy, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  describeWindow,
  formatMinute,
  hourOptions,
  ntpServerProblem,
  windowToSend,
  timezoneProblem,
  UPDATE_MODE_HINTS,
  UPDATE_MODE_LABELS,
  choiceOptions,
  UPDATE_MODES,
} from "../../device/settings";
import type { Settings } from "../../protocol/types";
import { useBoard, useSession } from "../board-context";
import { Banner } from "../components/banner";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import { ChoiceGroup } from "../components/choice";
import { SelectField } from "../components/select";
import { SwitchField } from "../components/switch";
import { ValueForm } from "../components/value-form";
import { ConfirmDialog } from "../components/confirm-dialog";
import { useCommit } from "../light/use-commit";
import { ZONE_TABLE } from "../../device/zones";
import { cn } from "../../lib/utils";
import { zoneText, ZoneSearch } from "./time-zone";

/** How long the install window waits after the last change of a time before it sends both. */
const WINDOW_SETTLE_MS = 1000;

/**
 * The install window: two times of day, sent together once both are valid, when a field is left or a second after the
 * last change (a time field changes at every digit typed). Nothing is sent while one of them is not a time of day.
 */
function InstallWindow({
  start,
  end,
  disabled,
  commit,
}: {
  /** What the board holds, with the choices not confirmed yet laid over it. */
  start: number;
  end: number;
  disabled: boolean;
  /** The card's commit, so a choice in flight stays shown until the board answers the latest one. */
  commit: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [from, setFrom] = useState(formatMinute(start));
  const [to, setTo] = useState(formatMinute(end));
  const [problem, setProblem] = useState<string | null>(null);
  const [seen, setSeen] = useState({ start, end });
  // A time changed and not sent yet: the board's answer to an earlier part of the same edit must not replace it
  const [editing, setEditing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // What the board holds replaces what was typed, unless the person is still changing it into a window that can be
  // sent: a draft that is not a time of day gives way
  if (seen.start !== start || seen.end !== end) {
    setSeen({ start, end });
    if (!editing || windowToSend(from, to, start, end) === "invalid") {
      setEditing(false);
      setProblem(null);
      setFrom(formatMinute(start));
      setTo(formatMinute(end));
    }
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function send(nextFrom: string, nextTo: string, leaving: boolean): void {
    window.clearTimeout(timer.current);
    const patch = windowToSend(nextFrom, nextTo, start, end);
    if (patch === "invalid") {
      if (leaving) setProblem("Choose a time of day for both, like 03:00.");
      return;
    }
    setProblem(null);
    setEditing(false);
    if (patch !== null) void commit(patch);
  }
  function change(nextFrom: string, nextTo: string): void {
    setEditing(true);
    setFrom(nextFrom);
    setTo(nextTo);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => send(nextFrom, nextTo, false), WINDOW_SETTLE_MS);
  }
  const field =
    "block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base disabled:opacity-50";
  return (
    <fieldset className="flex min-w-0 flex-col gap-3" disabled={disabled}>
      <legend className="mb-3 text-base font-medium">Install window</legend>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-base">
          <span className="mb-1 block">From</span>
          <input
            type="time"
            value={from}
            onChange={(e) => change(e.target.value, to)}
            onBlur={() => send(from, to, true)}
            className={field}
          />
        </label>
        <label className="block text-base">
          <span className="mb-1 block">Until</span>
          <input
            type="time"
            value={to}
            onChange={(e) => change(from, e.target.value)}
            onBlur={() => send(from, to, true)}
            className={field}
          />
        </label>
      </div>
      <p className="text-sm text-muted-foreground" data-testid="window-summary">
        {describeWindow(start, end)} Zenit installs new firmware by itself only inside this window. If both times are
        the same, it may install at any time of day.
      </p>
      {problem && (
        <p role="alert" className="text-base text-danger">
          {problem}
        </p>
      )}
    </fieldset>
  );
}

/** Whether the board reports any setting of the Advanced part (the update settings or the time). */
export const hasAdvancedSettings = (settings: Settings | null): boolean =>
  settings !== null && (settings.update_mode !== undefined || settings.timezone !== undefined);

/** How Zenit looks for firmware updates: the mode, the firmware switch, how often, and the install window. */
export function UpdateSettingsCard() {
  const { board } = useBoard();
  const { pending, commit } = useCommit();
  const settings = board.settings && { ...board.settings, ...pending };
  if (!settings || settings.update_mode === undefined || board.phase !== "connected") return null;
  const mode = settings.update_mode;
  const off = mode === "off";
  return (
    <Card aria-labelledby="update-settings-title">
      <CardTitle id="update-settings-title">Update settings</CardTitle>
      <div className="flex flex-col gap-5">
        <div>
          <ChoiceGroup
            legend="When a new version is published"
            groupName="update-mode"
            layout="grid-cols-1 sm:grid-cols-3"
            value={mode}
            onChange={(update_mode) => void commit({ update_mode })}
            options={choiceOptions(UPDATE_MODES, UPDATE_MODE_LABELS, mode)}
          />
          <p className="mt-2 text-sm text-muted-foreground" data-testid="update-mode-hint">
            {own(UPDATE_MODE_HINTS, mode) ?? ""}
          </p>
        </div>
        {settings.update_firmware !== undefined && (
          <SwitchField
            label="Update the firmware"
            hint="Turn this off to keep the firmware as it is, whatever the choice above."
            checked={settings.update_firmware}
            onChange={(update_firmware) => void commit({ update_firmware })}
          />
        )}
        {settings.update_web !== undefined && (
          <SwitchField
            label="Update the app on Zenit"
            hint="Turn this off to keep the app on Zenit as it is, whatever the choice above."
            checked={settings.update_web}
            onChange={(update_web) => void commit({ update_web })}
          />
        )}
        {settings.check_hours !== undefined && (
          <SelectField
            label="Look for updates"
            value={String(settings.check_hours)}
            options={hourOptions(board.settings?.check_hours)}
            onChange={(value) => void commit({ check_hours: Number(value) })}
            disabled={off}
          />
        )}
        {settings.install_start !== undefined && settings.install_end !== undefined && (
          <InstallWindow
            start={settings.install_start}
            end={settings.install_end}
            disabled={mode !== "automatic"}
            commit={commit}
          />
        )}
      </div>
    </Card>
  );
}

/**
 * The time zone and the clock of the board, which the install window and the dates depend on. `chosen` is the zone
 * chosen on this page, which names the board's string while it is still its string.
 */
export function TimeCard({ chosen, onChoose }: { chosen: string | null; onChoose: (name: string) => void }) {
  const { board } = useBoard();
  const { pending, commit } = useCommit();
  const settings = board.settings && { ...board.settings, ...pending };
  const zone = settings?.timezone;
  const named = zone !== undefined && ZONE_TABLE.boardZone(zone, chosen, null) !== null;
  // The raw field is open while the board holds a string no zone has, unless the person opened or closed it; choosing a
  // zone by search gives the field back to that rule
  const [rawChoice, setRawChoice] = useState<boolean | null>(null);
  const raw = rawChoice ?? !named;
  if (!settings || zone === undefined || board.phase !== "connected") return null;
  return (
    <Card aria-labelledby="time-title">
      <CardTitle id="time-title">Time</CardTitle>
      <div className="flex flex-col gap-5">
        <p className="text-base">
          <span className="text-muted-foreground">Time zone: </span>
          <span className={cn("font-medium break-words", !named && "font-mono")} data-testid="time-zone-current">
            {zoneText(zone, chosen)}
          </span>
        </p>
        <ZoneSearch
          onChoose={(choice) => {
            setRawChoice(null);
            onChoose(choice.name);
            void commit({ timezone: choice.posix });
          }}
        />
        <details
          open={raw}
          // The browser also fires toggle when the page sets `open`: only a change from what the page set is a choice
          onToggle={(event) => {
            if (event.currentTarget.open !== raw) setRawChoice(event.currentTarget.open);
          }}
          data-testid="time-zone-raw"
        >
          <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium">
            Type a POSIX time zone
          </summary>
          <div className="mt-2">
            <ValueForm
              label="Time zone text"
              hint="For experts: a POSIX time zone such as CET-1CEST,M3.5.0,M10.5.0/3."
              value={zone}
              validate={timezoneProblem}
              onSubmit={(timezone) => void commit({ timezone })}
            />
          </div>
        </details>
        {settings.ntp_server !== undefined && (
          <ValueForm
            label="Time server"
            hint="Where Zenit asks for the time. The default is fine for almost everyone."
            value={settings.ntp_server}
            validate={ntpServerProblem}
            onSubmit={(ntp_server) => void commit({ ntp_server })}
          />
        )}
        {settings.time_sync_hours !== undefined && (
          <SelectField
            label="Check the time"
            value={String(settings.time_sync_hours)}
            options={hourOptions(board.settings?.time_sync_hours)}
            onChange={(value) => void commit({ time_sync_hours: Number(value) })}
          />
        )}
      </div>
    </Card>
  );
}

function RegenerateToken() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Make a new token
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Make a new token?"
        confirm="Make a new token"
        tone="danger"
        onConfirm={() => void session.regenerateToken()}
      >
        The old token stops working. Every phone and computer that uses Zenit over WiFi has to log in again with the new
        one.
      </ConfirmDialog>
    </>
  );
}

function TokenRow({ token }: { token: string }) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-base font-medium">Token</span>
      <div className="flex flex-wrap items-center gap-2">
        <code
          className="min-h-11 grow rounded-xl border border-border bg-background px-3 py-2 font-mono text-base"
          data-testid="token"
        >
          {reveal ? token : "•".repeat(token.length)}
        </code>
        <Button
          type="button"
          variant="outline"
          aria-pressed={reveal}
          onClick={() => {
            setReveal((shown) => !shown);
            setCopied(false);
          }}
        >
          {reveal ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
          {reveal ? "Hide token" : "Show token"}
        </Button>
        <Button type="button" variant="outline" onClick={() => void copy()}>
          <Copy aria-hidden className="size-5" />
          Copy token
        </Button>
      </div>
      <p role="status" className="min-h-6 text-sm text-muted-foreground">
        {copied ? "Copied." : ""}
      </p>
    </div>
  );
}

/** The login for WiFi clients: the switch, and over USB the token with its reveal, copy and new-token actions. */
export function AccessCard() {
  const { board } = useBoard();
  const { pending, commit } = useCommit();
  const [asking, setAsking] = useState(false);
  const settings = board.settings && { ...board.settings, ...pending };
  if (!settings || settings.network_login === undefined || board.phase !== "connected") return null;
  const usb = board.kind === "usb";
  const on = settings.network_login;
  return (
    <Card aria-labelledby="access-title">
      <CardTitle id="access-title">Access over WiFi</CardTitle>
      <div className="flex flex-col gap-4">
        <SwitchField
          label="Ask for a token to log in"
          hint="Anyone on your WiFi can control Zenit unless you turn this on."
          checked={on}
          onChange={(next) => (next && !usb ? setAsking(true) : void commit({ network_login: next }))}
        />
        {on && (
          <p className="text-base text-muted-foreground">
            Phones and computers on your WiFi type the token once, when they connect. The token is not sent over the
            network.
          </p>
        )}
        {usb && settings.token !== undefined && <TokenRow token={settings.token} />}
        {usb && settings.token !== undefined && <RegenerateToken />}
        {!usb && (
          <p className="text-base text-muted-foreground" data-testid="token-usb-note">
            The token is shown only with the USB cable. Making a new one needs the USB cable too.
          </p>
        )}
      </div>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Turn on the login?"
        confirm="Turn on"
        onConfirm={() => void commit({ network_login: true })}
      >
        <p>
          Zenit closes this connection, and then asks for the token. You find the token in the Device page when Zenit is
          connected with the USB cable, or with the command line tool over USB.
        </p>
        <Banner tone="warning">Make sure you have the token before you continue.</Banner>
      </ConfirmDialog>
    </Card>
  );
}
