// SPDX-License-Identifier: GPL-3.0-or-later

import { ChevronDown, History, Usb, Wifi } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import {
  connectAddress,
  connectUsb,
  localNetworkAccess,
  MIXED_CONTENT_MESSAGE,
  serialSupported,
} from "../../board/connect";
import { servedOpener } from "../../board/served";
import { addressUnavailableHere, localHost } from "../../protocol/address";
import { loadAddress, saveAddress } from "../../lib/storage";
import { useBoard, useSession } from "../board-context";
import { Banner } from "../components/banner";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import type { Route } from "../route";

/** The USB choice: a button that opens the browser's port chooser, behind a warning about the panel power. */
function UsbChoice({ disabled, onConnect }: { disabled: boolean; onConnect: () => void }) {
  return (
    <>
      <Banner tone="warning" className="mb-3">
        Unplug the panel power socket before you connect the USB cable. Never use both at the same time.
      </Banner>
      <Button disabled={disabled} onClick={onConnect}>
        Connect with USB
      </Button>
    </>
  );
}

type Connect = (address: string, report: (problem: string | null) => void) => void;

/** Served by a Zenit: it is the board to talk to, so there is nothing to choose. */
function ServedConnect({ hostname, connecting }: { hostname: string; connecting: boolean }) {
  const session = useSession();
  return (
    <>
      <h1 className="text-2xl font-semibold">Your Zenit</h1>
      <Card>
        <CardTitle>{hostname}</CardTitle>
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
        To install firmware on a new Zenit, use the USB cable from the project's own page. A page from a Zenit cannot do
        it.
      </p>
    </>
  );
}

/** The last board that worked, for one tap. A problem with the stored address itself shows here. */
function LastBoardCard({ address, disabled, connect }: { address: string; disabled: boolean; connect: Connect }) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Card aria-labelledby="last-title" data-testid="last-board">
      <div className="flex flex-wrap items-center gap-3">
        <History aria-hidden className="size-6 shrink-0 text-muted-foreground" />
        <div className="min-w-0 grow">
          <h2 id="last-title" className="text-lg font-semibold break-all">
            {address}
          </h2>
          <p className="text-base text-muted-foreground">The Zenit you used last.</p>
        </div>
        <Button disabled={disabled} aria-label={`Connect to ${address}`} onClick={() => connect(address, setProblem)}>
          Connect
        </Button>
      </div>
      {problem && (
        <Banner tone="error" className="mt-3">
          {problem}
        </Banner>
      )}
    </Card>
  );
}

/** A field for the address of a Zenit, "another" one when the last board has its own card. */
function AddressCard({
  another,
  connecting,
  noAddress,
  asksFirst,
  connect,
}: {
  another: boolean;
  connecting: boolean;
  noAddress: boolean;
  asksFirst: boolean;
  connect: Connect;
}) {
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const addressId = useId();
  const hintId = useId();
  function submit(event: FormEvent): void {
    event.preventDefault();
    connect(address, setProblem);
  }
  return (
    <Card>
      <CardTitle className="flex items-center gap-2">
        <Wifi aria-hidden className="size-5" />
        {another ? "With another address" : "With an address"}
      </CardTitle>
      {noAddress && (
        <Banner tone="info" className="mb-3">
          {MIXED_CONTENT_MESSAGE}
        </Banner>
      )}
      <form onSubmit={submit} className="flex flex-col gap-3">
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
            For example zenit-1a2b.local or 192.168.1.20.
            {asksFirst && " The first time, Chrome asks to let this page find devices on your local network: allow it."}
          </p>
        </div>
        {problem && <Banner tone="error">{problem}</Banner>}
        <Button type="submit" disabled={connecting || noAddress}>
          Connect
        </Button>
      </form>
    </Card>
  );
}

const usbTitle = (
  <>
    <Usb aria-hidden className="size-5" />
    With a USB cable
  </>
);

export function ConnectView({ go }: { go: (route: Route) => void }) {
  const { board, session } = useBoard();
  const [last] = useState(loadAddress);
  // From click to answer, no second connection may start: the board has one slot
  const connecting = board.phase === "connecting" || board.opening;
  const lna = localNetworkAccess();
  const noAddress = addressUnavailableHere(location.protocol, location.hostname, lna);
  // A secure page of the site: Chrome asks once before this page may reach the local network
  const asksFirst = location.protocol === "https:" && lna && !localHost(location.hostname);
  const usbSupported = serialSupported();
  const hasLast = last !== "" && !noAddress;

  useEffect(() => {
    if (board.phase === "connected") go("light");
  }, [board.phase, go]);

  // A board that does not answer is a connection error, shown at the bottom of the screen; `report` gets only a
  // problem with the address as typed
  const connect: Connect = (typed, report) => {
    report(null);
    void connectAddress(session, typed).then(({ problem, reached }) => {
      report(problem);
      // Only an address that worked replaces the one offered next time
      if (reached) saveAddress(typed.trim());
    });
  };

  // The page asks its own origin whether a Zenit served it; the answer comes in a moment
  if (board.probing) {
    return (
      <p role="status" className="text-base text-muted-foreground">
        Looking for your Zenit...
      </p>
    );
  }

  if (board.served) return <ServedConnect hostname={board.served.hostname} connecting={connecting} />;

  const addressCard = (
    <AddressCard
      another={hasLast}
      connecting={connecting}
      noAddress={noAddress}
      asksFirst={asksFirst}
      connect={connect}
    />
  );

  return (
    <>
      <h1 className="text-2xl font-semibold">Connect to your Zenit</h1>
      {connecting && (
        <p role="status" className="text-base text-muted-foreground">
          Waiting for Zenit...
        </p>
      )}
      {hasLast && <LastBoardCard address={last} disabled={connecting} connect={connect} />}
      {usbSupported ? (
        <>
          <Card>
            <CardTitle className="flex items-center gap-2">{usbTitle}</CardTitle>
            <UsbChoice disabled={connecting} onConnect={() => void connectUsb(session)} />
          </Card>
          {addressCard}
        </>
      ) : (
        <>
          {addressCard}
          {/* This browser has no Web Serial (most phones): the USB choice is folded, with the reason in sight */}
          <details className="group rounded-2xl border border-border bg-card" data-testid="usb-folded">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 p-4 text-lg font-semibold sm:px-5 [&::-webkit-details-marker]:hidden">
              {usbTitle}
              <ChevronDown aria-hidden className="ml-auto size-5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <p className="mb-3 text-base text-muted-foreground">
                This browser cannot use a USB cable. Open the app in Chrome or Edge.
              </p>
              <UsbChoice disabled onConnect={() => undefined} />
            </div>
          </details>
        </>
      )}
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
