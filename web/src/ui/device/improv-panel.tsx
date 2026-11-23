// SPDX-License-Identifier: GPL-3.0-or-later

import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ImprovClient, ImprovError, type ImprovNetwork } from "../../protocol/improv-client";
import { boardAddress, describeSignal, passwordProblem, PHONE_ACCESS_HINT, ssidProblem } from "../../wifi/model";
import { useBoard } from "../board-context";
import { Banner } from "../components/banner";
import { Button } from "../components/button";

/** The sentence for a failed WiFi request over USB. A password is never in it. */
export function describeImprovError(error: unknown): string {
  if (error instanceof ImprovError) {
    switch (error.failure) {
      case "unable_to_connect":
        return "Zenit could not join that network. Check the name and the password, then try again.";
      case "invalid_rpc":
        return "Zenit did not accept that name or password.";
      case "unknown_rpc":
        return "This Zenit firmware cannot do that. Update the firmware.";
      case "timeout":
        return "Zenit did not answer. Try again.";
      case "busy":
        return "Zenit is still working on the last request. Wait a moment.";
      case "link":
        return "The USB connection failed. Check the cable.";
    }
  }
  return "Something went wrong.";
}

type Progress =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "connecting" }
  | { kind: "done"; hostname: string | null }
  | { kind: "failed"; message: string };

/** Setting up the WiFi of a board connected by USB, with Improv Wi-Fi Serial: scan, choose, type the password, connect. */
export function ImprovPanel() {
  const { session } = useBoard();
  const client = useRef<ImprovClient | null>(null);
  const [networks, setNetworks] = useState<ImprovNetwork[] | null>(null);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [progress, setProgress] = useState<Progress>({ kind: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const ssidId = useId();
  const passwordId = useId();
  const listId = useId();
  const working = progress.kind === "scanning" || progress.kind === "connecting";

  useEffect(
    () => () => {
      client.current?.dispose();
      client.current = null;
    },
    [],
  );

  const improv = (): ImprovClient | null => {
    const link = session.improvLink();
    if (!link) return null;
    client.current ??= new ImprovClient(link);
    return client.current;
  };

  async function scan(): Promise<void> {
    const active = improv();
    if (!active) return;
    setProblem(null);
    setProgress({ kind: "scanning" });
    try {
      setNetworks(await active.scan());
      setProgress({ kind: "idle" });
    } catch (error) {
      setProgress({ kind: "failed", message: describeImprovError(error) });
    }
  }

  async function connect(event: FormEvent): Promise<void> {
    event.preventDefault();
    const active = improv();
    const found = ssidProblem(ssid) ?? passwordProblem(password);
    setProblem(found);
    if (!active || found !== null) return;
    setProgress({ kind: "connecting" });
    try {
      await active.provision(ssid, password);
      setPassword("");
      setReveal(false);
      await session.refreshStatus();
      setProgress({ kind: "done", hostname: session.getState().wifi?.hostname ?? null });
    } catch (error) {
      setProgress({ kind: "failed", message: describeImprovError(error) });
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="wifi-setup">
      <div>
        <Button variant="outline" disabled={working} onClick={() => void scan()}>
          <RefreshCw aria-hidden className="size-5" />
          Scan for networks
        </Button>
        {progress.kind === "scanning" && (
          <p role="status" className="mt-2 text-base text-muted-foreground">
            Looking for WiFi networks, up to 15 seconds...
          </p>
        )}
        {networks !== null && networks.length === 0 && progress.kind !== "scanning" && (
          <p className="mt-2 text-base text-muted-foreground">Zenit sees no networks. Type the name of yours below.</p>
        )}
        {networks !== null && networks.length > 0 && (
          <ul aria-label="Networks Zenit sees" className="mt-3 flex flex-col gap-2" id={listId}>
            {networks.map((network) => (
              <li key={network.ssid}>
                <button
                  type="button"
                  aria-pressed={ssid === network.ssid}
                  onClick={() => setSsid(network.ssid)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-left text-base aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:ring-2 aria-pressed:ring-primary"
                >
                  <span className="min-w-0 break-words">{network.ssid}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {describeSignal(network.rssi)} signal, {network.secure ? "password" : "open"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={(event) => void connect(event)} className="flex flex-col gap-3">
        <div>
          <label htmlFor={ssidId} className="mb-1 block text-base font-medium">
            Network name
          </label>
          <input
            id={ssidId}
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={ssid}
            disabled={working}
            onChange={(event) => setSsid(event.target.value)}
            className="block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor={passwordId} className="mb-1 block text-base font-medium">
            Password
          </label>
          <div className="flex gap-2">
            <input
              id={passwordId}
              type={reveal ? "text" : "password"}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={password}
              disabled={working}
              onChange={(event) => setPassword(event.target.value)}
              className="block min-h-11 min-w-0 grow rounded-xl border border-border bg-background px-3 text-base disabled:opacity-50"
            />
            <Button
              type="button"
              variant="outline"
              className="px-3"
              aria-pressed={reveal}
              aria-label={reveal ? "Hide password" : "Show password"}
              onClick={() => setReveal((shown) => !shown)}
            >
              {reveal ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
            </Button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Leave it empty for a network with no password.</p>
        </div>
        {problem && <Banner tone="error">{problem}</Banner>}
        <Button type="submit" disabled={working}>
          Connect Zenit to this network
        </Button>
      </form>
      {progress.kind === "connecting" && (
        <p role="status" className="text-base">
          Connecting, up to 30 seconds. Keep the USB cable plugged in.
        </p>
      )}
      {progress.kind === "failed" && <Banner tone="error">{progress.message}</Banner>}
      {progress.kind === "done" && (
        <Banner tone="info">
          <p role="status" data-testid="wifi-done">
            {progress.hostname
              ? `Connected as ${progress.hostname}.local. Open ${boardAddress(progress.hostname)} on your phone or computer to control Zenit over WiFi. ${PHONE_ACCESS_HINT}`
              : "Connected. Zenit is on your WiFi."}
          </p>
        </Banner>
      )}
    </div>
  );
}
