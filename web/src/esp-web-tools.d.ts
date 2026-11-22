// SPDX-License-Identifier: GPL-3.0-or-later

import type { DetailedHTMLProps, HTMLAttributes } from "react";

// ESP Web Tools ships no types: its prebuilt bundle registers the install button element when it is imported.
declare module "esp-web-tools/dist/web/install-button.js";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "esp-web-install-button": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { manifest?: string };
    }
  }
}
