// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from "react";
import { choiceOptions, WIFI_POWER_LABELS, WIFI_POWERS } from "../../device/settings";
import { boardAddress, describeSignal, describeWifiState, PHONE_ACCESS_HINT } from "../../wifi/model";
import { useBoard } from "../board-context";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import { SelectField } from "../components/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "../components/alert-dialog";
import { useCommit } from "../light/use-commit";
import { ImprovPanel } from "./improv-panel";

function ForgetNetwork() {
  const { session } = useBoard();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Forget this network
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogTitle className="mb-2 text-lg font-semibold">Forget this WiFi network?</AlertDialogTitle>
          <AlertDialogDescription className="mb-4 text-base">
            Zenit leaves the network and turns its WiFi off. You can set it up again with the USB cable.
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="danger" onClick={() => void session.forgetWifi()}>
                Forget network
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The WiFi of the board: its state, the setup over USB, and the transmit power. Not shown for a board with no WiFi. */
export function WifiCard() {
  const { board } = useBoard();
  const { pending, commit } = useCommit();
  const { wifi, settings } = board;
  if (!wifi || board.phase !== "connected") return null;
  const usb = board.kind === "usb";
  const served = board.served !== null;
  const power = pending.wifi_power ?? settings?.wifi_power;
  return (
    <Card aria-labelledby="wifi-title">
      <CardTitle id="wifi-title">WiFi</CardTitle>
      <p role="status" className="text-base font-medium" data-testid="wifi-state">
        {describeWifiState(wifi.state, wifi.ssid)}
      </p>
      {wifi.state === "connected" && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
          <dt className="text-muted-foreground">Address</dt>
          <dd>{wifi.hostname}.local</dd>
          {wifi.ip && (
            <>
              <dt className="text-muted-foreground">Number</dt>
              <dd>{wifi.ip}</dd>
            </>
          )}
          {wifi.rssi !== null && (
            <>
              <dt className="text-muted-foreground">Signal</dt>
              <dd>{describeSignal(wifi.rssi)}</dd>
            </>
          )}
        </dl>
      )}
      {usb ? (
        <div className="mt-4 flex flex-col gap-4">
          <h3 className="text-base font-semibold">Set up the WiFi</h3>
          <ImprovPanel />
          {wifi.ssid !== null && <ForgetNetwork />}
          {!served && (
            <p className="text-sm text-muted-foreground">
              Once Zenit is on your WiFi, control it from its own address, {boardAddress(wifi.hostname)}. In an
              up-to-date Chrome or Edge, this page can also connect to it by that name. {PHONE_ACCESS_HINT}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-base text-muted-foreground" data-testid="wifi-usb-note">
          To change the WiFi network, or to make Zenit forget it, do it with the USB cable.
        </p>
      )}
      {settings?.wifi_power !== undefined && power !== undefined && (
        <div className="mt-4">
          <SelectField
            label="WiFi strength"
            hint="Automatic is right for most homes. Lower it only if Zenit keeps losing the connection."
            value={power}
            options={choiceOptions(WIFI_POWERS, WIFI_POWER_LABELS, settings.wifi_power)}
            onChange={(wifi_power) => void commit({ wifi_power })}
          />
        </div>
      )}
    </Card>
  );
}
