// SPDX-License-Identifier: GPL-3.0-or-later

import { lazy, Suspense, useId, useState } from "react";
import type { FirmwareManifest } from "../../release/manifest";
import { useBoard } from "../board-context";
import { Banner } from "../components/banner";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import { ConfirmDialog } from "../components/confirm-dialog";
import type { Route } from "../route";

// ESP Web Tools is large: it loads only when the installation starts.
const Installer = lazy(() => import("./installer"));

/** Where the manifest of the installer is, next to the app. */
const MANIFEST_PATH = "firmware/manifest.json";

export function FirmwareInstall({ published, go }: { published: FirmwareManifest | null; go: (route: Route) => void }) {
  const { board, session } = useBoard();
  const [asking, setAsking] = useState(false);
  const [unplugged, setUnplugged] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [stuck, setStuck] = useState(false);
  const checkId = useId();

  async function start(): Promise<void> {
    // The installer needs the port, and only one program can hold it: if it cannot be let go, the installer would fail
    if (board.kind === "usb" && !(await session.disconnect())) {
      setStuck(true);
      return;
    }
    setStuck(false);
    setAsking(false);
    setInstalling(true);
  }

  return (
    <Card aria-labelledby="install-title">
      <CardTitle id="install-title">Install or update the firmware</CardTitle>
      {installing ? (
        <div className="flex flex-col gap-3">
          <Banner tone="warning">Keep the USB cable plugged in until the installer says it is done.</Banner>
          <Suspense fallback={<p role="status">Loading the installer...</p>}>
            <Installer manifest={MANIFEST_PATH} />
          </Suspense>
          <Button
            variant="outline"
            onClick={() => {
              setInstalling(false);
              go("connect");
            }}
          >
            Done
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-base">
            {published
              ? `Installs version ${published.version} over a USB cable.`
              : "Installs the latest firmware over a USB cable."}{" "}
            Your settings are kept, unless you choose to erase everything.
          </p>
          <Button
            onClick={() => {
              setUnplugged(false);
              setStuck(false);
              setAsking(true);
            }}
          >
            Install or update firmware
          </Button>
        </>
      )}
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Before you connect the cable"
        confirm="Continue"
        disabled={!unplugged}
        keepOpen
        onConfirm={() => void start()}
        extra={
          <label htmlFor={checkId} className="mb-4 flex min-h-11 cursor-pointer items-center gap-3 text-base">
            <input
              id={checkId}
              type="checkbox"
              checked={unplugged}
              onChange={(event) => setUnplugged(event.target.checked)}
              className="size-6 accent-primary"
            />
            The panel power socket is unplugged
          </label>
        }
      >
        <Banner tone="warning">
          Unplug the panel power socket from the wall before you connect the USB cable. Never connect USB and the panel
          power together.
        </Banner>
        <p>
          Your settings are kept. The installer offers to erase everything for a clean install: choose that only if the
          Zenit misbehaves.
        </p>
        {stuck && (
          <Banner tone="error">
            The USB port is still in use. Unplug the USB cable, plug it in again, then reload this page.
          </Banner>
        )}
      </ConfirmDialog>
    </Card>
  );
}
