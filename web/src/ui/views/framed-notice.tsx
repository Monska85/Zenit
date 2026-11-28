// SPDX-License-Identifier: GPL-3.0-or-later

import { useTranslation } from "react-i18next";

/** What a page shown inside another site's page says instead of the app. */
export function FramedNotice() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-8">
      <h1 className="text-2xl font-semibold">Zenit</h1>
      <p className="text-base" data-testid="framed-notice">
        {t("framed.text")}
      </p>
      <p className="text-base">
        <a
          className="inline-flex min-h-11 items-center font-medium text-primary underline"
          href={location.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("framed.open")}
        </a>
      </p>
    </main>
  );
}
