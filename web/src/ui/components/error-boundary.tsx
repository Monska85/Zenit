// SPDX-License-Identifier: GPL-3.0-or-later

import { Component, type ReactNode } from "react";
import { i18n } from "../../i18n";
import { Button } from "./button";

/** The last guard of the page: a failure while drawing shows a sentence and Reload, never a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 pt-8">
        <h1 className="text-2xl font-semibold">{i18n.t("failure.title")}</h1>
        <p role="alert" className="text-base">
          {i18n.t("failure.text")}
        </p>
        <div>
          <Button onClick={() => location.reload()}>{i18n.t("failure.reload")}</Button>
        </div>
      </main>
    );
  }
}
