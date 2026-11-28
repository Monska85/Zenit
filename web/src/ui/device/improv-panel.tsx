// SPDX-License-Identifier: GPL-3.0-or-later

import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { message, translate, type Message } from "../../i18n";
import { ImprovClient, ImprovError, type ImprovNetwork } from "../../protocol/improv-client";
import { boardAddress, describeSignal, passwordProblem, phoneAccessHint, ssidProblem } from "../../wifi/model";
import { useSession } from "../board-context";
import { Banner } from "../components/banner";
import { Button } from "../components/button";

/** The message for a failed WiFi request over USB. A password is never in it. */
function describeImprovError(error: unknown, request: "scan" | "provision" = "provision"): Message {
  if (error instanceof ImprovError) {
    if (request === "scan" && error.failure === "invalid_rpc") return message("device:improv.errors.scanFailed");
    switch (error.failure) {
      case "unable_to_connect":
      case "invalid_rpc":
      case "unknown_rpc":
      case "timeout":
      case "busy":
      case "link":
        return message(`device:improv.errors.${error.failure}`);
    }
  }
  return message("errors:unknown");
}

type Progress =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "connecting" }
  | { kind: "done"; hostname: string | null }
  | { kind: "failed"; message: Message };

/** Setting up the WiFi of a board connected by USB, with Improv Wi-Fi Serial: scan, choose, type the password, connect. */
export function ImprovPanel() {
  const { t } = useTranslation("device");
  const session = useSession();
  const client = useRef<ImprovClient | null>(null);
  const [networks, setNetworks] = useState<ImprovNetwork[] | null>(null);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [progress, setProgress] = useState<Progress>({ kind: "idle" });
  const [problem, setProblem] = useState<Message | null>(null);
  const ssidId = useId();
  const passwordId = useId();
  const listId = useId();
  const working = progress.kind === "scanning" || progress.kind === "connecting";
  const connectedAs = (hostname: string): string =>
    t("improv.connectedAs", { hostname, address: boardAddress(hostname) });

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
      setProgress({ kind: "failed", message: describeImprovError(error, "scan") });
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
      await session.refreshStatus();
      setProgress({ kind: "done", hostname: session.getState().wifi?.hostname ?? null });
    } catch (error) {
      setProgress({ kind: "failed", message: describeImprovError(error) });
    } finally {
      // The password was sent: it leaves the form whatever the board answered, and a new try types it again
      setPassword("");
      setReveal(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="wifi-setup">
      <div>
        <Button variant="outline" disabled={working} onClick={() => void scan()}>
          <RefreshCw aria-hidden className="size-5" />
          {t("improv.scan")}
        </Button>
        {progress.kind === "scanning" && (
          <p role="status" className="mt-2 text-base text-muted-foreground">
            {t("improv.scanning")}
          </p>
        )}
        {networks !== null && networks.length === 0 && progress.kind !== "scanning" && (
          <p className="mt-2 text-base text-muted-foreground">{t("improv.noNetworks")}</p>
        )}
        {networks !== null && networks.length > 0 && (
          <ul aria-label={t("improv.networks")} className="mt-3 flex flex-col gap-2" id={listId}>
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
                    {network.secure
                      ? t("improv.networkSecure", { signal: describeSignal(network.rssi) })
                      : t("improv.networkOpen", { signal: describeSignal(network.rssi) })}
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
            {t("improv.networkName")}
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
            {t("improv.password")}
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
              size="icon"
              aria-pressed={reveal}
              aria-label={reveal ? t("improv.hidePassword") : t("improv.showPassword")}
              onClick={() => setReveal((shown) => !shown)}
            >
              {reveal ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
            </Button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("improv.passwordHint")}</p>
        </div>
        {problem && <Banner tone="error">{translate(problem)}</Banner>}
        <Button type="submit" disabled={working}>
          {t("improv.connect")}
        </Button>
      </form>
      {progress.kind === "connecting" && (
        <p role="status" className="text-base">
          {t("improv.connecting")}
        </p>
      )}
      {progress.kind === "failed" && <Banner tone="error">{translate(progress.message)}</Banner>}
      {progress.kind === "done" && (
        <Banner tone="info">
          <p role="status" data-testid="wifi-done">
            {progress.hostname ? `${connectedAs(progress.hostname)} ${phoneAccessHint()}` : t("improv.connected")}
          </p>
        </Banner>
      )}
    </div>
  );
}
