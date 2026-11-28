// SPDX-License-Identifier: GPL-3.0-or-later

import { lazy, Suspense, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FirmwareManifest } from "../../release/manifest";
import { useBoard } from "../board-context";
import { Banner } from "../components/banner";
import { Button } from "../components/button";
import { ConfirmDialog } from "../components/confirm-dialog";
import type { Route } from "../route";

// ESP Web Tools is large: it loads only when the installation starts.
const Installer = lazy(() => import("./installer"));

/** Where the manifest of the installer is, next to the app. */
const MANIFEST_PATH = "firmware/manifest.json";

/** The install over a USB cable, as a part of the Maintenance card: its root stays a <section>, which the card's
 * divider between parts relies on. */
export function FirmwareInstall({ published, go }: { published: FirmwareManifest | null; go: (route: Route) => void }) {
  const { t } = useTranslation("device");
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
    <section aria-labelledby="install-title">
      <h3 id="install-title" className="mb-2 text-base font-semibold">
        {t("install.title")}
      </h3>
      {installing ? (
        <div className="flex flex-col gap-3">
          <Banner tone="warning">{t("install.keepPlugged")}</Banner>
          <Suspense fallback={<p role="status">{t("install.loading")}</p>}>
            <Installer manifest={MANIFEST_PATH} />
          </Suspense>
          <Button
            variant="outline"
            onClick={() => {
              setInstalling(false);
              go("connect");
            }}
          >
            {t("install.done")}
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-base">
            {published ? t("install.version", { version: published.version }) : t("install.latest")}{" "}
            {t("install.settingsKept")}
          </p>
          <Button
            onClick={() => {
              setUnplugged(false);
              setStuck(false);
              setAsking(true);
            }}
          >
            {t("install.button")}
          </Button>
        </>
      )}
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t("install.dialog.title")}
        confirm={t("install.dialog.confirm")}
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
            {t("install.dialog.unplugged")}
          </label>
        }
      >
        <Banner tone="warning">{t("install.dialog.warning")}</Banner>
        <p>{t("install.dialog.text")}</p>
        {stuck && <Banner tone="error">{t("install.dialog.stuck")}</Banner>}
      </ConfirmDialog>
    </section>
  );
}
