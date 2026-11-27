// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from "react";
import type { FirmwareManifest } from "../../release/manifest";
import { useBoard } from "../board-context";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import { ConfirmDialog } from "../components/confirm-dialog";
import type { Route } from "../route";
import { FirmwareInstall } from "../views/firmware-install";

/** Reset to defaults: over USB a button that asks first; over WiFi a sentence. Left out while not connected. */
function ResetPart() {
  const { board, session } = useBoard();
  const [open, setOpen] = useState(false);
  if (board.phase !== "connected") return null;
  return (
    <section aria-labelledby="reset-title">
      <h3 id="reset-title" className="mb-2 text-base font-semibold">
        Reset to defaults
      </h3>
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
    </section>
  );
}

/** The rare and careful tools, last on the page: reset, and installing firmware over a USB cable. */
export function MaintenanceCard({ published, go }: { published: FirmwareManifest | null; go: (route: Route) => void }) {
  const { board } = useBoard();
  return (
    <Card aria-labelledby="maintenance-title">
      <CardTitle id="maintenance-title">Maintenance</CardTitle>
      {/* Each part's root is a <section>: the divider between two parts is drawn on that */}
      <div className="flex flex-col gap-5 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-5">
        <ResetPart />
        {board.served !== null ? (
          <section aria-labelledby="install-title">
            <h3 id="install-title" className="mb-2 text-base font-semibold">
              Install or update the firmware
            </h3>
            <p className="text-base text-muted-foreground" data-testid="install-served-note">
              Installing firmware over a USB cable needs a page from the internet (the browser allows it only there).
              Open the project's page on a computer with Chrome or Edge, and connect Zenit with the USB cable. Updates
              over WiFi work from here.
            </p>
          </section>
        ) : (
          <FirmwareInstall published={published} go={go} />
        )}
      </div>
    </Card>
  );
}
