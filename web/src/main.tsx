// SPDX-License-Identifier: GPL-3.0-or-later

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { connectServed } from "./board/served";
import { startTheme } from "./lib/theme";
import { App } from "./ui/app";
import { session } from "./ui/board-context";

startTheme();

// A page served by a board over http connects to that board by itself
if (location.protocol === "http:") {
  session.beginProbe();
  void connectServed(session);
}

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
