// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { choiceOptions, WIFI_POWER_LABELS, WIFI_POWERS } from "../../device/settings";
import { boardAddress, describeSignal, describeWifiState, phoneAccessHint } from "../../wifi/model";
import { useBoard, useSession } from "../board-context";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import { SelectField } from "../components/select";
import { ConfirmDialog } from "../components/confirm-dialog";
import { useCommit } from "../light/use-commit";
import { ImprovPanel } from "./improv-panel";

function ForgetNetwork() {
  const { t } = useTranslation("device");
  const session = useSession();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("wifi.forget.button")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("wifi.forget.title")}
        confirm={t("wifi.forget.confirm")}
        tone="danger"
        onConfirm={() => void session.forgetWifi()}
      >
        {t("wifi.forget.text")}
      </ConfirmDialog>
    </>
  );
}

/** The WiFi of the board: its state, the setup over USB, and the transmit power. Not shown for a board with no WiFi. */
export function WifiCard() {
  const { t } = useTranslation("device");
  const { board } = useBoard();
  const { pending, commit } = useCommit();
  const { wifi, settings } = board;
  if (!wifi || board.phase !== "connected") return null;
  const usb = board.kind === "usb";
  const served = board.served !== null;
  const power = pending.wifi_power ?? settings?.wifi_power;
  return (
    <Card aria-labelledby="wifi-title">
      <CardTitle id="wifi-title">{t("wifi.title")}</CardTitle>
      <p role="status" className="text-base font-medium" data-testid="wifi-state">
        {describeWifiState(wifi.state, wifi.ssid)}
      </p>
      {wifi.state === "connected" && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
          <dt className="text-muted-foreground">{t("wifi.address")}</dt>
          <dd>{wifi.hostname}.local</dd>
          {wifi.ip && (
            <>
              <dt className="text-muted-foreground">{t("wifi.number")}</dt>
              <dd>{wifi.ip}</dd>
            </>
          )}
          {wifi.rssi !== null && (
            <>
              <dt className="text-muted-foreground">{t("wifi.signal")}</dt>
              <dd>{describeSignal(wifi.rssi)}</dd>
            </>
          )}
        </dl>
      )}
      {usb ? (
        <div className="mt-4 flex flex-col gap-4">
          <h3 className="text-base font-semibold">{t("wifi.setUp")}</h3>
          <ImprovPanel />
          {wifi.ssid !== null && <ForgetNetwork />}
          {!served && (
            <p className="text-sm text-muted-foreground">
              {t("wifi.ownAddress", { address: boardAddress(wifi.hostname) })} {phoneAccessHint()}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-base text-muted-foreground" data-testid="wifi-usb-note">
          {t("wifi.usbNote")}
        </p>
      )}
      {settings?.wifi_power !== undefined && power !== undefined && (
        <div className="mt-4">
          <SelectField
            label={t("wifi.power.label")}
            hint={t("wifi.power.hint")}
            value={power}
            options={choiceOptions(WIFI_POWERS, WIFI_POWER_LABELS, settings.wifi_power)}
            onChange={(wifi_power) => void commit({ wifi_power })}
          />
        </div>
      )}
    </Card>
  );
}
