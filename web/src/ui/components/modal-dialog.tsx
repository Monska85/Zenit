// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * A modal dialog on the native `dialog` element: the browser traps focus, makes the rest of the page inert, closes on
 * Escape and returns focus to the control that opened it. The content is mounted only while the dialog is open, so a
 * form starts fresh each time. Focus starts on the first control, or on the one marked `data-autofocus` (a text field
 * is then selected, so typing replaces it). `onClose` is called however the dialog closes.
 */
export function ModalDialog({
  open,
  onClose,
  title,
  children,
  role = "dialog",
  describedBy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** `alertdialog` for a question that needs an answer. */
  role?: "dialog" | "alertdialog";
  /** The id of the text that describes the dialog. */
  describedBy?: string;
}) {
  const element = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = element.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const target = dialog.querySelector<HTMLElement>("[data-autofocus]");
      target?.focus();
      if (target instanceof HTMLInputElement) target.select();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={element}
      role={role}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      aria-modal="true"
      // A dialog inside this one closes too, and React passes its event up the tree: only this dialog's own counts
      onClose={(event) => event.target === event.currentTarget && onClose()}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-5 text-base text-foreground shadow-xl backdrop:bg-black/50"
    >
      {open && (
        <>
          <h2 id={titleId} className="mb-3 text-lg font-semibold">
            {title}
          </h2>
          {children}
        </>
      )}
    </dialog>
  );
}
