// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from "react";
import { colorLabel, colorSetLabel, effectInfo } from "../../light/model";
import { firmwareState, readManifest, type FirmwareManifest } from "../../release/manifest";
import { useBoard } from "../board-context";
import { Banner } from "../components/banner";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import { ConfirmDialog } from "../components/confirm-dialog";
import { AccessCard, TimeCard, UpdateSettingsCard } from "../device/settings-cards";
import { UpdateCard, WebAppCard } from "../device/update-card";
import { WifiCard } from "../device/wifi-card";
import type { Route } from "../route";
import { FirmwareInstall } from "./firmware-install";

/** The firmware published next to the app, or null while it loads, or when there is none (a local build, offline). */
function usePublishedFirmware(enabled: boolean): FirmwareManifest | null | "missing" {
  const [manifest, setManifest] = useState<FirmwareManifest | null | "missing">(null);
  useEffect(() => {
    // A page served by a board has no published firmware next to it
    if (!enabled) return;
    const controller = new AbortController();
    fetch(new URL("firmware/manifest.json", document.baseURI), { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => setManifest(readManifest(value) ?? "missing"))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setManifest("missing");
      });
    return () => controller.abort();
  }, [enabled]);
  return enabled ? manifest : "missing";
}

const watts = (milliwatts: number): string => `${Number((milliwatts / 1000).toFixed(2))} W`;

function FirmwareCard({ published }: { published: FirmwareManifest | null | "missing" }) {
  const { board } = useBoard();
  const running = board.info?.firmware;
  const state =
    running !== undefined && published !== null && published !== "missing"
      ? firmwareState(running, published.version)
      : null;
  const sentence = {
    up_to_date: "Your Zenit is up to date.",
    update_available: "An update is available.",
    newer: "Your Zenit runs a newer build than the published one.",
    unknown: "The versions cannot be compared.",
  };
  return (
    <Card aria-labelledby="firmware-title">
      <CardTitle id="firmware-title">Firmware</CardTitle>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
        {running !== undefined && (
          <>
            <dt className="text-muted-foreground">On your Zenit</dt>
            <dd data-testid="firmware-running">{running}</dd>
          </>
        )}
        {!board.served && (
          <>
            <dt className="text-muted-foreground">Latest published</dt>
            <dd data-testid="firmware-published">
              {published === null ? "Checking..." : published === "missing" ? "Not available" : published.version}
            </dd>
          </>
        )}
      </dl>
      {state && (
        <p role="status" className="mt-3 text-base font-medium" data-testid="firmware-state">
          {sentence[state]}
        </p>
      )}
      {published === "missing" && !board.served && (
        <p className="mt-3 text-base text-muted-foreground">
          The published firmware could not be read. This happens when the app runs on your own computer, or offline.
        </p>
      )}
    </Card>
  );
}

function BoardCard() {
  const { board } = useBoard();
  const { info } = board;
  if (!info) return null;
  const rows: Array<[string, string]> = [
    ["Connection", board.kind === "usb" ? "USB cable" : board.label],
    ["Hardware", info.board],
    ["Light power limit", watts(info.power_limit_mw)],
    ["Colors", info.colors.map(colorLabel).join(", ")],
    ["Effects", info.effects.map((effect) => effectInfo(effect).label).join(", ")],
    ["Palettes", info.color_sets.map(colorSetLabel).join(", ")],
  ];
  return (
    <Card aria-labelledby="device-title">
      <CardTitle id="device-title">Your Zenit</CardTitle>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
        {rows.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <details className="mt-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium">
          Details for technicians
        </summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
          <dt className="text-muted-foreground">Protocol</dt>
          <dd>{info.protocol}</dd>
          <dt className="text-muted-foreground">Free memory</dt>
          <dd>{info.memory.free === 0 ? "Not reported" : `${info.memory.free.toLocaleString("en-GB")} bytes`}</dd>
          <dt className="text-muted-foreground">Settings memory</dt>
          <dd>
            {info.nvs.used === 0 && info.nvs.free === 0
              ? "Not reported"
              : `${info.nvs.used} used, ${info.nvs.free} free`}
          </dd>
        </dl>
      </details>
    </Card>
  );
}

function ResetCard() {
  const { board, session } = useBoard();
  const [open, setOpen] = useState(false);
  if (board.phase !== "connected") return null;
  return (
    <Card aria-labelledby="reset-title">
      <CardTitle id="reset-title">Reset to defaults</CardTitle>
      {board.kind === "usb" ? (
        <>
          <p className="mb-3 text-base text-muted-foreground">Puts every setting back to how Zenit came.</p>
          <Button variant="outline" onClick={() => setOpen(true)}>
            Reset to defaults
          </Button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="Reset to defaults?"
            confirm="Reset"
            tone="danger"
            onConfirm={() => void session.resetSettings()}
          >
            Every setting goes back to its default. The light changes to the default look. Zenit also forgets its WiFi
            network and makes a new token.
          </ConfirmDialog>
        </>
      ) : (
        <p className="text-base text-muted-foreground">Resetting needs a USB cable. Connect with USB to do it.</p>
      )}
    </Card>
  );
}

export function DeviceView({ go }: { go: (route: Route) => void }) {
  const { board } = useBoard();
  const served = board.served !== null;
  const published = usePublishedFirmware(!served);
  return (
    <>
      <h1 className="text-2xl font-semibold">Device</h1>
      {board.info ? (
        <BoardCard />
      ) : (
        <Banner tone="info">
          <p>Connect to see your Zenit.</p>
          <a className="inline-flex min-h-11 items-center font-medium text-primary underline" href="#/connect">
            Connect
          </a>
        </Banner>
      )}
      <WifiCard />
      <FirmwareCard published={published} />
      <UpdateCard />
      <WebAppCard />
      <UpdateSettingsCard />
      <TimeCard />
      <AccessCard />
      <ResetCard />
      {served ? (
        <Card aria-labelledby="install-title">
          <CardTitle id="install-title">Install or update the firmware</CardTitle>
          <p className="text-base text-muted-foreground" data-testid="install-served-note">
            Installing firmware over a USB cable needs a page from the internet (the browser allows it only there). Open
            the project's page on a computer with Chrome or Edge, and connect Zenit with the USB cable. Updates over
            WiFi work from here.
          </p>
        </Card>
      ) : (
        <FirmwareInstall published={published === "missing" ? null : published} go={go} />
      )}
    </>
  );
}
