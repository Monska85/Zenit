// SPDX-License-Identifier: GPL-3.0-or-later

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import { connectServed } from "./board/served";
import { startTheme } from "./lib/theme";
import { App } from "./ui/app";
import { session } from "./ui/board-context";
import { ErrorBoundary } from "./ui/components/error-boundary";
import { FramedNotice } from "./ui/views/framed-notice";

/** Whether another page shows this one inside a frame (a site cannot send `frame-ancestors` from a static host). */
function framed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

startTheme();

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");

if (framed()) {
  // Inside another site's page the app could be steered by clicks it cannot see: it shows only a way out
  createRoot(root).render(<FramedNotice />);
} else {
  // A page served by a board over http connects to that board by itself
  if (location.protocol === "http:") {
    session.beginProbe();
    void connectServed(session);
  }
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
