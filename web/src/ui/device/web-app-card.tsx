// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from "react";
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
      <CardTitle id="web-app-title">App on Zenit</CardTitle>
      <p className="text-base" data-testid="web-state">
        {describeWebState(web)}
      </p>
      {web.version !== null && (
        <p className="mt-1 text-sm text-muted-foreground" data-testid="web-version">
          Version {web.version}.
        </p>
      )}
      {on ? (
        <p className="mt-3 text-base" data-testid="web-result">
          {describeWebResult(web)}
        </p>
      ) : (
        <p className="mt-3 text-base" data-testid="web-off">
          Zenit does not look for new versions of the app. You can turn this on in Advanced settings.
        </p>
      )}
      {retry && (
        <p className="mt-1 text-sm text-muted-foreground" data-testid="web-retry">
          {retry}
        </p>
      )}
      {install && web.available !== null && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => setAsking(true)}>Install app {web.available}</Button>
        </div>
      )}
      {web.available !== null && (
        <ConfirmDialog
          open={asking}
          onOpenChange={setAsking}
          title={`Install version ${web.available} of the app?`}
          confirm="Install"
          onConfirm={() => void session.installWebUpdate()}
        >
          Zenit downloads the new app and keeps the light as it is. It does not restart. When the app is installed,
          pages open on Zenit load it again by themselves.
        </ConfirmDialog>
      )}
    </Card>
  );
}
