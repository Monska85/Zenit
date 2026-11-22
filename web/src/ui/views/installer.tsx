// SPDX-License-Identifier: GPL-3.0-or-later

// Loaded on demand: importing ESP Web Tools registers its install button element.
import "esp-web-tools/dist/web/install-button.js";

export default function Installer({ manifest }: { manifest: string }) {
  return (
    <esp-web-install-button manifest={manifest}>
      <button
        slot="activate"
        type="button"
        className="min-h-11 w-full rounded-xl bg-primary px-4 py-2 text-base font-medium text-primary-foreground"
      >
        Start the installation
      </button>
      <span slot="unsupported" className="text-base">
        This browser cannot install firmware. Use Chrome or Edge on a computer.
      </span>
      <span slot="not-allowed" className="text-base">
        The browser does not allow the installer here.
      </span>
    </esp-web-install-button>
  );
}
