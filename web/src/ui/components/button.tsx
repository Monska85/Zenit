// SPDX-License-Identifier: GPL-3.0-or-later

import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "../../lib/utils";

const BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl py-2 text-base font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";

const VARIANTS = {
  default: "bg-primary text-primary-foreground hover:opacity-90",
  outline: "border border-border bg-card text-foreground hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
  danger: "bg-danger text-background hover:opacity-90",
} as const;

/** `icon`: a button that holds only an icon, with less room at its sides. */
const SIZES = { default: "px-4", icon: "px-3" } as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  asChild?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ref,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component ref={ref} className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />;
}
