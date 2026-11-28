// SPDX-License-Identifier: GPL-3.0-or-later

// The English catalogs: the source language, bundled with the app. Other languages are loaded when chosen
// (./index.ts). A new namespace is added here and as a file in every language folder of ../locales/.

import common from "../locales/en/common.json";
import connect from "../locales/en/connect.json";
import device from "../locales/en/device.json";
import errors from "../locales/en/errors.json";
import favorites from "../locales/en/favorites.json";
import light from "../locales/en/light.json";
import privacy from "../locales/en/privacy.json";

export const en = { common, connect, device, errors, favorites, light, privacy };

export type Namespace = keyof typeof en;

export const NAMESPACES = Object.keys(en) as Namespace[];
