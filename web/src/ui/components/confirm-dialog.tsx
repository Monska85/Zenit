// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./alert-dialog";
import { Button } from "./button";

/**
 * A question with Cancel and one confirming button. The confirm button closes the dialog unless `keepOpen` is set:
 * then the caller closes it, once what it started has worked.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  extra,
  confirm,
  tone = "default",
  disabled = false,
  keepOpen = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** The text under the title: it is what a screen reader reads as the description. */
  children: ReactNode;
  /** A control that belongs to the question but not to its description, shown above the buttons. */
  extra?: ReactNode;
  confirm: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  keepOpen?: boolean;
  onConfirm: () => void;
}) {
  const button = (
    <Button variant={tone} disabled={disabled} onClick={onConfirm}>
      {confirm}
    </Button>
  );
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle className="mb-2 text-lg font-semibold">{title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="mb-4 flex flex-col gap-3 text-base">{children}</div>
        </AlertDialogDescription>
        {extra}
        <div className="flex justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline">Cancel</Button>
          </AlertDialogCancel>
          {keepOpen ? button : <AlertDialogAction asChild>{button}</AlertDialogAction>}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
