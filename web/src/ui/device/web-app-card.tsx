// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { canInstallWeb, describeRetry, describeWebResult, describeWebState, webUpdatesOn } from "../../device/update";
import { useBoard } from "../board-context";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import { ConfirmDialog } from "../components/confirm-dialog";

/**
 * The app the board serves to phones and computers on the WiFi: its own copy, kept up to date apart from the firmware
 * (docs/board/wifi-and-updates-v1.md#web-image). Shown only by a firmware that reports it.
 */
export function WebAppCard() {
  const { t } = useTranslation("device");
  const { board, session } = useBoard();
  const [asking, setAsking] = useState(false);
  const { update, wifi } = board;
  const web = update?.web;
  if (!update || !web || board.phase !== "connected") return null;
  const on = webUpdatesOn(board.settings);
  const retry = describeRetry(web.retry_in);
  const install = canInstallWeb(update, wifi, on);
  return (
    <Card aria-labelledby="web-app-title">
      <CardTitle id="web-app-title">{t("webApp.title")}</CardTitle>
      <p className="text-base" data-testid="web-state">
        {describeWebState(web)}
      </p>
      {web.version !== null && (
        <p className="mt-1 text-sm text-muted-foreground" data-testid="web-version">
          {t("webApp.version", { version: web.version })}
        </p>
      )}
      {on ? (
        <p className="mt-3 text-base" data-testid="web-result">
          {describeWebResult(web)}
        </p>
      ) : (
        <p className="mt-3 text-base" data-testid="web-off">
          {t("webApp.updatesOff")}
        </p>
      )}
      {retry && (
        <p className="mt-1 text-sm text-muted-foreground" data-testid="web-retry">
          {retry}
        </p>
      )}
      {install && web.available !== null && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => setAsking(true)}>{t("webApp.installButton", { version: web.available })}</Button>
        </div>
      )}
      {web.available !== null && (
        <ConfirmDialog
          open={asking}
          onOpenChange={setAsking}
          title={t("webApp.install.title", { version: web.available })}
          confirm={t("webApp.install.confirm")}
          onConfirm={() => void session.installWebUpdate()}
        >
          {t("webApp.install.text")}
        </ConfirmDialog>
      )}
    </Card>
  );
}
