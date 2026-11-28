// SPDX-License-Identifier: GPL-3.0-or-later

import { Lightbulb, SlidersHorizontal, Sparkles } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { translate } from "../i18n";
import { cn } from "../lib/utils";
import { BoardProvider, useBoard } from "./board-context";
import { BottomMessage } from "./components/bottom-message";
import { clearNotice, useNotice } from "./notice";
import { screenOf, useRoute, type Route } from "./route";
import { LostBanner } from "./shell/lost-banner";
import { StatusMenu } from "./shell/status-menu";
import { useBackAgain } from "./shell/use-back-again";
import { ConnectView } from "./views/connect-view";
import { LightView } from "./views/light-view";
import { LoginView } from "./views/login-view";
import { DevicePlaceholder } from "./views/device-placeholder";

// The Device and Privacy pages load when they are opened: the first screen is the Light or Connect view.
const DeviceView = lazy(() => import("./views/device-view").then((module) => ({ default: module.DeviceView })));
const PrivacyView = lazy(() => import("./views/privacy-view").then((module) => ({ default: module.PrivacyView })));

const TABS = [
  { route: "light", label: "tabs.light", Icon: Lightbulb },
  { route: "device", label: "tabs.device", Icon: SlidersHorizontal },
] as const satisfies ReadonlyArray<{ route: Route; label: string; Icon: typeof Lightbulb }>;

function Shell() {
  const { t } = useTranslation();
  const { board, session } = useBoard();
  const [current, go] = useRoute();
  const [backAgain, hideBackAgain] = useBackAgain(board.phase, board.opening);
  const screen = screenOf(current, board.phase);
  // A lost connection has one banner, with its reason and Reconnect, above any view but the Connect screen (where the
  // person is already choosing a board); the reason is then not said twice
  const lostBanner = board.phase === "lost" && screen !== "connect";
  const error = lostBanner ? null : board.error;
  const notice = useNotice();
  // A confirmation is about the connection it came from
  useEffect(() => clearNotice, [board.phase]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 pt-3 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-8">
      <header className="flex items-center justify-between gap-2">
        <a href="#/light" className="flex min-h-11 shrink-0 items-center gap-2 text-xl font-semibold">
          <Sparkles aria-hidden className="size-6 text-primary" />
          Zenit
        </a>
        <StatusMenu go={go} />
      </header>
      <nav
        aria-label={t("tabs.label")}
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] sm:static sm:gap-1 sm:rounded-2xl sm:border sm:p-1"
      >
        {TABS.map(({ route, label, Icon }) => {
          const active = route === current || (route === "light" && current === "connect");
          return (
            <a
              key={route}
              href={`#/${route}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-sm font-medium sm:min-h-11 sm:flex-row sm:gap-2 sm:rounded-xl sm:px-3 sm:text-base",
                active
                  ? "text-primary sm:bg-primary sm:text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted sm:text-foreground",
              )}
            >
              <Icon aria-hidden className="size-6 sm:size-5" />
              {t(label)}
            </a>
          );
        })}
      </nav>
      {lostBanner && <LostBanner />}
      <main className="flex flex-col gap-4">
        <Suspense fallback={null}>
          {screen === "privacy" && <PrivacyView />}
          {screen === "login" && <LoginView go={go} />}
          {screen === "device" && (
            <Suspense fallback={<DevicePlaceholder />}>
              <DeviceView go={go} />
            </Suspense>
          )}
          {screen === "connect" && <ConnectView go={go} />}
          {screen === "light" && <LightView />}
        </Suspense>
      </main>
      <footer className="mt-auto flex justify-center pt-4 text-sm">
        <a
          href="#/privacy"
          aria-current={current === "privacy" ? "page" : undefined}
          className="inline-flex min-h-11 items-center px-3 text-muted-foreground underline hover:text-foreground"
        >
          {t("footer.privacy")}
        </a>
      </footer>
      {/* Kept in the page, so a screen reader hears the confirmation when it appears */}
      <p role="status" className="sr-only">
        {error === null ? (notice !== null ? translate(notice) : backAgain ? t("connectedAgain") : "") : ""}
      </p>
      {error !== null ? (
        <BottomMessage tone="error" onClose={() => session.dismissError()}>
          {translate(error)}
        </BottomMessage>
      ) : notice !== null ? (
        <BottomMessage tone="done" onClose={clearNotice}>
          {translate(notice)}
        </BottomMessage>
      ) : (
        backAgain && (
          <BottomMessage tone="done" onClose={hideBackAgain}>
            {t("connectedAgain")}
          </BottomMessage>
        )
      )}
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
