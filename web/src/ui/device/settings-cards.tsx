// SPDX-License-Identifier: GPL-3.0-or-later

import { own } from "../../lib/own";
import { Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import {
  BOARD_LIMITS,
  describeWindow,
  formatMinute,
  hoursProblem,
  ntpServerProblem,
  parseMinute,
  TIME_ZONES,
  timezoneProblem,
  UPDATE_MODE_HINTS,
  UPDATE_MODE_LABELS,
  choiceOptions,
  UPDATE_MODES,
} from "../../device/settings";
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

const CUSTOM = "custom";

function InstallWindow({ start, end, disabled }: { start: number; end: number; disabled: boolean }) {
  const { commit } = useCommit();
  const [from, setFrom] = useState(formatMinute(start));
  const [to, setTo] = useState(formatMinute(end));
  const [problem, setProblem] = useState<string | null>(null);
  const [seen, setSeen] = useState({ start, end });
  // What the board holds replaces what was typed
  if (seen.start !== start || seen.end !== end) {
    setSeen({ start, end });
    setFrom(formatMinute(start));
    setTo(formatMinute(end));
  }
  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const install_start = parseMinute(from);
    const install_end = parseMinute(to);
    if (install_start === null || install_end === null) {
      setProblem("Choose a time of day for both, like 03:00.");
      return;
    }
    setProblem(null);
    void commit({ install_start, install_end });
  }
  const field =
    "block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base disabled:opacity-50";
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-labelledby="window-title">
      <h3 id="window-title" className="text-base font-medium">
        Install window
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-base">
          <span className="mb-1 block">From</span>
          <input
            type="time"
            value={from}
            disabled={disabled}
            onChange={(e) => setFrom(e.target.value)}
            className={field}
          />
        </label>
        <label className="block text-base">
          <span className="mb-1 block">Until</span>
          <input type="time" value={to} disabled={disabled} onChange={(e) => setTo(e.target.value)} className={field} />
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
      <div>
        <Button type="submit" variant="outline" disabled={disabled}>
          Set window
        </Button>
      </div>
    </form>
  );
}

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
          <ValueForm
            label="Look for updates every (hours)"
            inputMode="numeric"
            value={String(settings.check_hours)}
            validate={(text) => hoursProblem(text, BOARD_LIMITS.check_hours)}
            onSubmit={(text) => void commit({ check_hours: Number(text) })}
            disabled={off}
          />
        )}
        {settings.install_start !== undefined && settings.install_end !== undefined && (
          <InstallWindow start={settings.install_start} end={settings.install_end} disabled={mode !== "automatic"} />
        )}
      </div>
    </Card>
  );
}

/** The time zone and the clock of the board, which the install window and the dates depend on. */
export function TimeCard() {
  const { board } = useBoard();
  const { pending, commit } = useCommit();
  const [custom, setCustom] = useState(false);
  const settings = board.settings && { ...board.settings, ...pending };
  if (!settings || settings.timezone === undefined || board.phase !== "connected") return null;
  const zone = settings.timezone;
  const listed = TIME_ZONES.some((entry) => entry.value === zone);
  const customShown = custom || !listed;
  return (
    <Card aria-labelledby="time-title">
      <CardTitle id="time-title">Time</CardTitle>
      <div className="flex flex-col gap-5">
        <SelectField
          label="Time zone"
          value={customShown ? CUSTOM : zone}
          options={[...TIME_ZONES, { value: CUSTOM, label: "Another time zone..." }]}
          onChange={(value) => {
            if (value === CUSTOM) setCustom(true);
            else {
              setCustom(false);
              void commit({ timezone: value });
            }
          }}
        />
        {customShown && (
          <ValueForm
            label="Time zone text"
            hint="A POSIX time zone such as CET-1CEST,M3.5.0,M10.5.0/3."
            value={zone}
            validate={timezoneProblem}
            onSubmit={(timezone) => void commit({ timezone })}
          />
        )}
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
          <ValueForm
            label="Check the time every (hours)"
            inputMode="numeric"
            value={String(settings.time_sync_hours)}
            validate={(text) => hoursProblem(text, BOARD_LIMITS.time_sync_hours)}
            onSubmit={(text) => void commit({ time_sync_hours: Number(text) })}
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
