// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from "react";
import {
  webUpdatesOn,
  canCheck,
  canInstallWeb,
  describeResult,
  describeRetry,
  describeWebResult,
  describeWebState,
  describeUpdateState,
  firmwareUpdatesOn,
  formatCheckTime,
  installAction,
  updateBusy,
  updatesOn,
} from "../../device/update";
import { useBoard } from "../board-context";
import { Banner } from "../components/banner";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "../components/alert-dialog";

function InstallDialog({
  version,
  force,
  open,
  onOpenChange,
}: {
  version: string;
  force: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { session } = useBoard();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle className="mb-2 text-lg font-semibold">
          {force ? `Install version ${version} anyway?` : `Install version ${version}?`}
        </AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="mb-4 flex flex-col gap-3 text-base">
            {force && (
              <Banner tone="warning">
                This version did not work on this Zenit before, and Zenit went back to the earlier one. It may fail the
                same way. If it does, Zenit goes back again by itself.
              </Banner>
            )}
            <p>
              Zenit downloads the new firmware and then restarts. The light goes dark for a moment and fades in again.
              Keep Zenit powered until it is back, which takes a minute or so.
            </p>
          </div>
        </AlertDialogDescription>
        <div className="flex justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline">Cancel</Button>
          </AlertDialogCancel>
          <Button
            variant={force ? "danger" : "default"}
            onClick={() => {
              onOpenChange(false);
              void session.installUpdate(force);
            }}
          >
            {force ? "Install anyway" : "Install"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** What the board reports about firmware updates, and the two things to ask of it: look now, and install. */
export function UpdateCard() {
  const { board, session } = useBoard();
  const [asking, setAsking] = useState(false);
  const { update, wifi } = board;
  if (!update || board.phase !== "connected") return null;
  const action = installAction(update, wifi, board.settings);
  const progressText = describeUpdateState(update);
  // The progress line is read out when the state changes, not at every percent: the bar carries the number
  const progressWords = describeUpdateState({ ...update, progress: null });
  const checked = formatCheckTime(update.last_check);
  const found = update.available;
  return (
    <Card aria-labelledby="updates-title">
      <CardTitle id="updates-title">Firmware updates</CardTitle>
      {!updatesOn(update) ? (
        <p className="text-base" data-testid="update-off">
          Updates are turned off. Zenit does not look for new firmware. You can turn them on below.
        </p>
      ) : !firmwareUpdatesOn(update, board.settings) ? (
        <p className="text-base" data-testid="update-off">
          Firmware updates are turned off in the settings below, so Zenit does not look for new firmware.
        </p>
      ) : (
        <>
          <p className="text-base" data-testid="update-result">
            {found !== null && update.last_result === "available"
              ? `Version ${found} is available.`
              : describeResult(update.last_result)}
          </p>
          {checked && (
            <p className="mt-1 text-sm text-muted-foreground" data-testid="update-checked">
              Last checked {checked}.
            </p>
          )}
        </>
      )}
      {progressText && (
        <div className="mt-3" data-testid="update-progress">
          <p role="status" className="text-base font-medium">
            <span aria-hidden>{progressText}</span>
            <span className="sr-only">{progressWords}</span>
          </p>
          {update.state === "downloading" && (
            <div
              role="progressbar"
              aria-label="Download progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={update.progress ?? undefined}
              className="mt-2 h-3 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary" style={{ width: `${update.progress ?? 0}%` }} />
            </div>
          )}
        </div>
      )}
      {update.trial && (
        <p className="mt-3 text-base text-muted-foreground">
          This firmware is on trial. It confirms itself in a moment, and until then Zenit does not install another one.
        </p>
      )}
      {update.rolled_back !== null && (
        <Banner tone="warning" className="mt-3">
          Version {update.rolled_back} did not work on this Zenit, so Zenit went back to the version it had before.
        </Banner>
      )}
      {update.skipped !== null && (
        <p className="mt-3 text-base text-muted-foreground">
          Version {update.skipped} is set aside and is not installed by itself.
        </p>
      )}
      {firmwareUpdatesOn(update, board.settings) && wifi !== null && wifi.state !== "connected" && (
        <p className="mt-3 text-base text-muted-foreground">Zenit needs WiFi to look for and install updates.</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!canCheck(update, wifi, webUpdatesOn(board.settings), board.settings)}
          onClick={() => void session.checkUpdate()}
        >
          Check now
        </Button>
        {action !== "none" && found !== null && (
          <Button
            variant={action === "force" ? "danger" : "default"}
            disabled={updateBusy(update)}
            onClick={() => setAsking(true)}
          >
            {action === "force" ? `Install ${found} anyway` : `Install ${found}`}
          </Button>
        )}
      </div>
      {found !== null && (
        <InstallDialog version={found} force={action === "force"} open={asking} onOpenChange={setAsking} />
      )}
    </Card>
  );
}

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
          Zenit does not look for new versions of the app. You can turn this on in the update settings.
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
        <AlertDialog open={asking} onOpenChange={setAsking}>
          <AlertDialogContent>
            <AlertDialogTitle className="mb-2 text-lg font-semibold">
              Install version {web.available} of the app?
            </AlertDialogTitle>
            <AlertDialogDescription className="mb-4 text-base">
              Zenit downloads the new app and keeps the light as it is. It does not restart. When the app is installed,
              pages open on Zenit load it again by themselves.
            </AlertDialogDescription>
            <div className="flex justify-end gap-2">
              <AlertDialogCancel asChild>
                <Button variant="outline">Cancel</Button>
              </AlertDialogCancel>
              <Button
                onClick={() => {
                  setAsking(false);
                  void session.installWebUpdate();
                }}
              >
                Install
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}
