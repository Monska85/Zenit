// SPDX-License-Identifier: GPL-3.0-or-later

import { Usb, Wifi } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { connectAddress, connectUsb, serialSupported } from "../../board/connect";
import { servedOpener } from "../../board/served";
import { addressUnavailableHere } from "../../protocol/address";
import { loadAddress, saveAddress } from "../../lib/storage";
import { useBoard } from "../board-context";
import { Banner } from "../components/banner";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import type { Route } from "../route";

export function ConnectView({ go }: { go: (route: Route) => void }) {
  const { board, session } = useBoard();
  const [address, setAddress] = useState(loadAddress);
  const [problem, setProblem] = useState<string | null>(null);
  const addressId = useId();
  const hintId = useId();
  // From click to answer, no second connection may start: the board has one slot
  const connecting = board.phase === "connecting" || board.opening;
  const noAddress = addressUnavailableHere(location.protocol, location.hostname);
  const usbSupported = serialSupported();

  useEffect(() => {
    if (board.phase === "connected") go("light");
  }, [board.phase, go]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setProblem(null);
    const message = await connectAddress(session, address);
    setProblem(message);
    if (message === null) saveAddress(address.trim());
  }

  // The page asks its own origin whether a Zenit served it; the answer comes in a moment
  if (board.probing) {
    return (
      <p role="status" className="text-base text-muted-foreground">
        Looking for your Zenit...
      </p>
    );
  }

  // Served by a Zenit: it is the board to talk to, so there is nothing to choose
  if (board.served) {
    return (
      <>
        <h1 className="text-2xl font-semibold">Your Zenit</h1>
        <Card>
          <CardTitle>{board.served.hostname}</CardTitle>
          <p className="mb-3 text-base">This page comes from your Zenit, so it connects to it by itself.</p>
          {connecting ? (
            <p role="status" className="text-base text-muted-foreground">
              Waiting for Zenit...
            </p>
          ) : (
            <Button onClick={() => void session.open(servedOpener(location.host), location.host)}>Connect</Button>
          )}
        </Card>
        <p className="text-base text-muted-foreground">
          To install firmware on a new Zenit, use the USB cable from the project's own page. A page from a Zenit cannot
          do it.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Connect to your Zenit</h1>
      {connecting && (
        <p role="status" className="text-base text-muted-foreground">
          Waiting for Zenit...
        </p>
      )}
      <Card>
        <CardTitle className="flex items-center gap-2">
          <Usb aria-hidden className="size-5" />
          With a USB cable
        </CardTitle>
        <Banner tone="warning" className="mb-3">
          Unplug the panel power socket before you connect the USB cable. Never use both at the same time.
        </Banner>
        <Button disabled={connecting || !usbSupported} onClick={() => void connectUsb(session)}>
          Connect with USB
        </Button>
        {!usbSupported && (
          <p className="mt-2 text-sm text-muted-foreground">
            This browser cannot use a USB cable. Open the app in Chrome or Edge.
          </p>
        )}
      </Card>
      <Card>
        <CardTitle className="flex items-center gap-2">
          <Wifi aria-hidden className="size-5" />
          With an address
        </CardTitle>
        {noAddress && (
          <Banner tone="info" className="mb-3">
            From this page a Zenit is reached with the USB cable. Over WiFi, open the Zenit's own address in the
            browser.
          </Banner>
        )}
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <div>
            <label htmlFor={addressId} className="mb-1 block text-base font-medium">
              Address of your Zenit
            </label>
            <input
              id={addressId}
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={address}
              disabled={noAddress}
              onChange={(event) => setAddress(event.target.value)}
              aria-describedby={hintId}
              placeholder="zenit-1a2b.local"
              className="block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
            />
            <p id={hintId} className="mt-1 text-sm text-muted-foreground">
              For example zenit-1a2b.local, 192.168.1.20 or ws://127.0.0.1:8765 for the simulator.
            </p>
          </div>
          {problem && <Banner tone="error">{problem}</Banner>}
          <Button type="submit" disabled={connecting || noAddress}>
            Connect
          </Button>
        </form>
      </Card>
      <p className="text-base text-muted-foreground">
        New Zenit with no firmware yet?{" "}
        <a className="font-medium text-primary underline" href="#/device">
          Install the firmware
        </a>
        .
      </p>
    </>
  );
}
