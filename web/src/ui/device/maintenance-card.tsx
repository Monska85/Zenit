// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FirmwareManifest } from "../../release/manifest";
import { useBoard } from "../board-context";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import { ConfirmDialog } from "../components/confirm-dialog";
import type { Route } from "../route";
import { FirmwareInstall } from "../views/firmware-install";

/** Reset to defaults: over USB a button that asks first; over WiFi a sentence. Left out while not connected. */
function ResetPart() {
  const { t } = useTranslation("device");
  const { board, session } = useBoard();
  const [open, setOpen] = useState(false);
  if (board.phase !== "connected") return null;
  return (
    <section aria-labelledby="reset-title">
      <h3 id="reset-title" className="mb-2 text-base font-semibold">
        {t("maintenance.reset.title")}
      </h3>
      {board.kind === "usb" ? (
        <>
          <p className="mb-3 text-base text-muted-foreground">{t("maintenance.reset.text")}</p>
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t("maintenance.reset.button")}
          </Button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title={t("maintenance.reset.dialogTitle")}
            confirm={t("maintenance.reset.confirm")}
            tone="danger"
            onConfirm={() => void session.resetSettings()}
          >
            {t("maintenance.reset.dialogText")}
          </ConfirmDialog>
        </>
      ) : (
        <p className="text-base text-muted-foreground">{t("maintenance.reset.needsUsb")}</p>
      )}
    </section>
  );
}

/** The rare and careful tools, last on the page: reset, and installing firmware over a USB cable. */
export function MaintenanceCard({ published, go }: { published: FirmwareManifest | null; go: (route: Route) => void }) {
  const { t } = useTranslation("device");
  const { board } = useBoard();
  return (
    <Card aria-labelledby="maintenance-title">
      <CardTitle id="maintenance-title">{t("maintenance.title")}</CardTitle>
      {/* Each part's root is a <section>: the divider between two parts is drawn on that */}
      <div className="flex flex-col gap-5 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-5">
        <ResetPart />
        {board.served !== null ? (
          <section aria-labelledby="install-title">
            <h3 id="install-title" className="mb-2 text-base font-semibold">
              {t("install.title")}
            </h3>
            <p className="text-base text-muted-foreground" data-testid="install-served-note">
              {t("maintenance.servedNote")}
            </p>
          </section>
        ) : (
          <FirmwareInstall published={published} go={go} />
        )}
      </div>
    </Card>
  );
}
