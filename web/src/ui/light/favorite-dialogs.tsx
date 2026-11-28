// SPDX-License-Identifier: GPL-3.0-or-later

import { ChevronRight } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import type { FavoriteOutcome } from "../../board/session";
import { favoriteLimits, favoriteNameProblem } from "../../light/model";
import type { BoardInfo, Favorite } from "../../protocol/types";
import { Button } from "../components/button";
import { ChoiceGroup } from "../components/choice";
import { ModalDialog } from "../components/modal-dialog";
import { SwitchField } from "../components/switch";
import { FavoriteNameField } from "./favorite-name-field";

/** A line inside a dialog: what a request made in it came to. Shown here because the bottom message is behind the dialog. */
export interface Note {
  tone: "error" | "done";
  text: string;
}

/**
 * The note of a dialog. A confirmation is a polite status (its region is always there, so it is announced when its text
 * arrives); an error is an alert.
 */
export function DialogNote({ note }: { note: Note | null }) {
  return (
    <>
      <p role="status" className="text-base">
        {note?.tone === "done" ? note.text : null}
      </p>
      {note?.tone === "error" && (
        <p role="alert" className="text-base text-danger">
          {note.text}
        </p>
      )}
    </>
  );
}

/** A name field with the Save or Rename flow around it: checked when the button is pressed, cleared when typing. */
function useNameForm(
  initial: string,
  favorites: readonly Favorite[],
  exceptId: number | null,
  max: number,
  send: (name: string) => Promise<FavoriteOutcome>,
) {
  const [text, setText] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(initial);
  // The board's name replaces what was typed (another phone renamed it, or a rename worked)
  if (seen !== initial) {
    setSeen(initial);
    setText(initial);
  }
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const checked = favoriteNameProblem(text, favorites, exceptId, max);
    setProblem(checked.problem);
    if (checked.problem !== null) return;
    setBusy(true);
    try {
      const outcome = await send(checked.name);
      setProblem(outcome.nameProblem ? outcome.message : null);
    } finally {
      setBusy(false);
    }
  }
  return {
    text,
    problem,
    busy,
    change: (value: string) => {
      setText(value);
      setProblem(null);
    },
    submit,
  };
}

/** "Save this light": a name, prefilled and selected, and the board copies the light as it is. */
export function SaveDialog({
  open,
  onClose,
  info,
  favorites,
  defaultName,
  note,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  info: BoardInfo;
  favorites: readonly Favorite[];
  defaultName: string;
  note: Note | null;
  onSave: (name: string) => Promise<FavoriteOutcome>;
}) {
  return (
    <ModalDialog open={open} onClose={onClose} title="Save this light">
      <SaveForm
        info={info}
        favorites={favorites}
        defaultName={defaultName}
        note={note}
        onSave={onSave}
        onClose={onClose}
      />
    </ModalDialog>
  );
}

function SaveForm({
  info,
  favorites,
  defaultName,
  note,
  onSave,
  onClose,
}: {
  info: BoardInfo;
  favorites: readonly Favorite[];
  defaultName: string;
  note: Note | null;
  onSave: (name: string) => Promise<FavoriteOutcome>;
  onClose: () => void;
}) {
  const limits = favoriteLimits(info);
  const form = useNameForm(defaultName, favorites, null, limits.name, onSave);
  return (
    <form onSubmit={(event) => void form.submit(event)} className="flex flex-col gap-4">
      <FavoriteNameField
        value={form.text}
        max={limits.name}
        problem={form.problem}
        disabled={form.busy}
        autoFocus
        hint={`Up to ${limits.name} characters.`}
        onChange={form.change}
      />
      <DialogNote note={note} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={form.busy}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** At the most favorites: choose one to replace with the light as it is now. It keeps its name and its mark. */
export function FullDialog({
  open,
  onClose,
  info,
  favorites,
  note,
  onReplace,
}: {
  open: boolean;
  onClose: () => void;
  info: BoardInfo;
  favorites: readonly Favorite[];
  note: Note | null;
  onReplace: (favorite: Favorite) => Promise<FavoriteOutcome>;
}) {
  return (
    <ModalDialog open={open} onClose={onClose} title="Your favorites are full">
      <FullForm info={info} favorites={favorites} note={note} onReplace={onReplace} onClose={onClose} />
    </ModalDialog>
  );
}

function FullForm({
  info,
  favorites,
  note,
  onReplace,
  onClose,
}: {
  info: BoardInfo;
  favorites: readonly Favorite[];
  note: Note | null;
  onReplace: (favorite: Favorite) => Promise<FavoriteOutcome>;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = favorites.find((item) => String(item.id) === chosen);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!target || busy) return;
    setBusy(true);
    try {
      await onReplace(target);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <p>
        Zenit keeps up to {favoriteLimits(info).count} favorites. Choose one to replace with this light, or delete one
        first in Edit.
      </p>
      <ChoiceGroup
        legend="Favorite to replace"
        hideLegend
        groupName="replace-favorite"
        layout="grid-cols-1"
        value={chosen}
        onChange={setChosen}
        disabled={busy}
        options={favorites.map((item) => ({ value: String(item.id), label: item.name, name: item.name }))}
      />
      <DialogNote note={note} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!target || busy}>
          Replace
        </Button>
      </div>
    </form>
  );
}

/** "Edit favorites": every favorite as a row that opens its sheet. */
export function EditDialog({
  open,
  onClose,
  favorites,
  note,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  favorites: readonly Favorite[];
  note: Note | null;
  onOpen: (favorite: Favorite) => void;
}) {
  return (
    <ModalDialog open={open} onClose={onClose} title="Edit favorites">
      <ul className="mb-4 flex flex-col gap-2">
        {favorites.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-base font-medium hover:bg-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">{item.name}</span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      <DialogNote note={note} />
      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </div>
    </ModalDialog>
  );
}

/** What a favorite's sheet can do. Each returns the outcome, and the sheet is busy until it does. */
export interface SheetActions {
  rename: (favorite: Favorite, name: string) => Promise<FavoriteOutcome>;
  useNow: (favorite: Favorite) => Promise<FavoriteOutcome>;
  setStart: (favorite: Favorite, on: boolean) => Promise<FavoriteOutcome>;
  remove: (favorite: Favorite) => Promise<FavoriteOutcome>;
}

/** One favorite: its name, "Use the light as it is now", "Turn on with this" and Delete (which asks first). */
export function FavoriteSheet({
  favorite,
  start,
  favorites,
  info,
  actions,
  note,
  onClose,
}: {
  /** The favorite to show, or null while no sheet is open. */
  favorite: Favorite | null;
  start: number | null;
  favorites: readonly Favorite[];
  info: BoardInfo;
  actions: SheetActions;
  note: Note | null;
  onClose: () => void;
}) {
  return (
    <ModalDialog open={favorite !== null} onClose={onClose} title={favorite?.name ?? ""}>
      {favorite && (
        <SheetBody
          key={favorite.id}
          favorite={favorite}
          start={start}
          favorites={favorites}
          info={info}
          actions={actions}
          note={note}
          onClose={onClose}
        />
      )}
    </ModalDialog>
  );
}

function SheetBody({
  favorite,
  start,
  favorites,
  info,
  actions,
  note,
  onClose,
}: {
  favorite: Favorite;
  start: number | null;
  favorites: readonly Favorite[];
  info: BoardInfo;
  actions: SheetActions;
  note: Note | null;
  onClose: () => void;
}) {
  const limits = favoriteLimits(info);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const form = useNameForm(favorite.name, favorites, favorite.id, limits.name, (name) =>
    actions.rename(favorite, name),
  );
  const holder = start !== null && start !== favorite.id ? favorites.find((item) => item.id === start) : undefined;
  const hintId = useId();
  const questionId = useId();
  async function act(action: Promise<FavoriteOutcome>): Promise<void> {
    setBusy(true);
    try {
      await action;
    } finally {
      setBusy(false);
    }
  }
  const working = busy || form.busy;
  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={(event) => void form.submit(event)} className="flex flex-col gap-2">
        <FavoriteNameField
          value={form.text}
          max={limits.name}
          problem={form.problem}
          disabled={working}
          onChange={form.change}
        />
        <Button type="submit" variant="outline" disabled={working} className="self-start">
          Rename
        </Button>
      </form>
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="outline"
          disabled={working}
          aria-describedby={hintId}
          onClick={() => void act(actions.useNow(favorite))}
        >
          Use the light as it is now
        </Button>
        <p id={hintId} className="text-sm text-muted-foreground">
          {favorite.name} will show the light you see now.
        </p>
      </div>
      <SwitchField
        label="Turn on with this"
        hint={
          <>
            <span className="block">
              Zenit shows {favorite.name} when it gets power and when you turn the light on.
            </span>
            {holder && <span className="block">Now {holder.name} has it; this moves it here.</span>}
          </>
        }
        checked={start === favorite.id}
        disabled={working}
        onChange={(on) => void act(actions.setStart(favorite, on))}
      />
      <DialogNote note={note} />
      <div className="flex justify-between gap-2 border-t border-border pt-4">
        <Button type="button" variant="danger" disabled={working} onClick={() => setAsking(true)}>
          Delete
        </Button>
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </div>
      <ModalDialog
        open={asking}
        onClose={() => setAsking(false)}
        title={`Delete ${favorite.name}?`}
        role="alertdialog"
        describedBy={questionId}
      >
        <p id={questionId} className="mb-4">
          You can save a new favorite any time.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" data-autofocus onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              setAsking(false);
              void act(actions.remove(favorite));
            }}
          >
            Delete
          </Button>
        </div>
      </ModalDialog>
    </div>
  );
}
