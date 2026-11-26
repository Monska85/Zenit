// SPDX-License-Identifier: GPL-3.0-or-later

import { clsx, type ClassValue } from "clsx";

/** Joins class names. A caller never passes a class that conflicts with a component's own: a variant covers that. */
export const cn = (...inputs: ClassValue[]): string => clsx(inputs);
