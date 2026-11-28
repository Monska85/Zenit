// SPDX-License-Identifier: GPL-3.0-or-later

// Loaded on demand: importing ESP Web Tools registers its install button element.
import "esp-web-tools/dist/web/install-button.js";
import { useTranslation } from "react-i18next";

export default function Installer({ manifest }: { manifest: string }) {
  const { t } = useTranslation("device");
  return (
    <esp-web-install-button manifest={manifest}>
      <button
        slot="activate"
        type="button"
        className="min-h-11 w-full rounded-xl bg-primary px-4 py-2 text-base font-medium text-primary-foreground"
      >
        {t("install.start")}
      </button>
      <span slot="unsupported" className="text-base">
        {t("install.unsupported")}
      </span>
      <span slot="not-allowed" className="text-base">
        {t("install.notAllowed")}
      </span>
    </esp-web-install-button>
  );
}
