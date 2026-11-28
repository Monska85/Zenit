// SPDX-License-Identifier: GPL-3.0-or-later

// Typed keys: a key or a namespace the English catalogs do not have is a TypeScript error.

import "i18next";
import type { en } from "./resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: typeof en;
  }
}
