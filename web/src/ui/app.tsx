// SPDX-License-Identifier: GPL-3.0-or-later

import { Monitor, Moon, Sparkles, Sun, Unplug } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { chooseTheme, currentTheme, NEXT_THEME } from "../lib/theme";
import type { ThemeChoice } from "../lib/storage";
import { cn } from "../lib/utils";
import { BoardProvider, useBoard, useSession } from "./board-context";
import { Banner } from "./components/banner";
import { Button } from "./components/button";
import { useRoute, type Route } from "./route";
import { ConnectView } from "./views/connect-view";
import { LightView } from "./views/light-view";
import { LoginView } from "./views/login-view";

// The Device and Privacy pages load when they are opened: the first screen is the Light or Connect view.
const DeviceView = lazy(() => import("./views/device-view").then((module) => ({ default: module.DeviceView })));
const PrivacyView = lazy(() => import("./views/privacy-view").then((module) => ({ default: module.PrivacyView })));

const THEME_ICONS: Record<ThemeChoice, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };
const THEME_NAMES: Record<ThemeChoice, string> = { system: "Match my device", light: "Light", dark: "Dark" };

function ThemeButton() {
  const [choice, setChoice] = useState<ThemeChoice>(currentTheme);
  const Icon = THEME_ICONS[choice];
  const next = NEXT_THEME[choice];
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => {
        chooseTheme(next);
        setChoice(next);
      }}
      aria-label={`Theme: ${THEME_NAMES[choice]}. Change to ${THEME_NAMES[next]}.`}
    >
      <Icon aria-hidden className="size-5" />
    </Button>
  );
}

function DisconnectButton({ go }: { go: (route: Route) => void }) {
  const session = useSession();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Disconnect"
      onClick={() => {
        void session.disconnect();
        go("connect");
      }}
    >
      <Unplug aria-hidden className="size-5" />
    </Button>
  );
}

function ConnectionChip({ go }: { go: (route: Route) => void }) {
  const { board, session } = useBoard();
  if (board.phase === "connecting") return <span className="text-sm text-muted-foreground">Connecting...</span>;
  if (board.phase === "login") {
    return (
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium">Log in needed</span>
        {/* The page is the board's own: there is no other place to connect to */}
        {!board.served && <DisconnectButton go={go} />}
      </div>
    );
  }
  if (board.phase === "connected") {
    return (
      <div className="flex items-center gap-1">
        <span className="text-sm" data-testid="connection" title={board.label}>
          {board.kind === "usb" ? "Connected by USB" : "Connected over WiFi"}
        </span>
        {board.served && (
          <span className="text-sm text-muted-foreground" data-testid="hostname">
            {board.served.hostname}
          </span>
        )}
        {/* The page is the board's own: there is no other place to connect to */}
        {!board.served && <DisconnectButton go={go} />}
      </div>
    );
  }
  if (board.phase === "lost") {
    if (board.auto !== null) {
      return (
        <span role="status" className="text-sm font-medium" data-testid="auto-reconnect">
          {board.auto === "restarting" ? "The board is restarting" : "Connecting again..."}
        </span>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-danger">Connection lost</span>
        <Button variant="outline" disabled={board.opening} onClick={() => void session.reconnect()}>
          Reconnect
        </Button>
      </div>
    );
  }
  return null;
}

function Shell() {
  const { board, session } = useBoard();
  const [current, go] = useRoute();
  const tabs: Array<{ route: Route; label: string }> = [
    { route: "light", label: "Light" },
    { route: "device", label: "Device" },
    { route: "privacy", label: "Privacy" },
  ];
  // The Light view is the front page: without a connection it is the Connect screen.
  // A lost connection keeps its last values on the Light view, greyed, with Reconnect in the header.
  const connectScreen =
    current === "connect" || (current === "light" && (board.phase === "disconnected" || board.phase === "connecting"));

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 pt-3 pb-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <a href="#/light" className="flex min-h-11 items-center gap-2 text-xl font-semibold">
          <Sparkles aria-hidden className="size-6 text-primary" />
          Zenit
        </a>
        <div className="flex items-center gap-1">
          <ConnectionChip go={go} />
          <ThemeButton />
        </div>
      </header>
      <nav aria-label="Pages" className="flex gap-1 rounded-2xl border border-border bg-card p-1">
        {tabs.map((tab) => {
          const active = tab.route === current || (tab.route === "light" && current === "connect");
          return (
            <a
              key={tab.route}
              href={`#/${tab.route}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-base font-medium",
                active ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {tab.label}
            </a>
          );
        })}
      </nav>
      {board.error && (
        <Banner tone="error" onClose={() => session.dismissError()}>
          {board.error}
        </Banner>
      )}
      <main className="flex flex-col gap-4">
        <Suspense fallback={null}>
          {current === "privacy" && <PrivacyView />}
          {current !== "privacy" && board.phase === "login" && <LoginView go={go} />}
          {current === "device" && board.phase !== "login" && <DeviceView go={go} />}
          {(current === "light" || current === "connect") &&
            board.phase !== "login" &&
            (connectScreen ? <ConnectView go={go} /> : <LightView />)}
        </Suspense>
      </main>
    </div>
  );
}

export function App() {
  return (
    <BoardProvider>
      <Shell />
    </BoardProvider>
  );
}
