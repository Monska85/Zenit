// SPDX-License-Identifier: GPL-3.0-or-later

import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** `label` and `valueText` go to the thumb, the element assistive technology reads as the slider. */
export function Slider({
  className,
  label,
  valueText,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root> & { label: string; valueText: string }) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-11 w-full touch-none items-center select-none", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-2.5 grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        aria-valuetext={valueText}
        className="block size-7 rounded-full border-2 border-primary bg-card shadow transition-colors"
      />
    </SliderPrimitive.Root>
  );
}
