// SPDX-License-Identifier: GPL-3.0-or-later

import { Check, Pencil, Plus, Power } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FavoriteOutcome } from "../../board/session";
import { i18n, message, type Message } from "../../i18n";
import { cn } from "../../lib/utils";
import {
  defaultFavoriteName,
  effectInfo,
  EFFECTS,
  favoriteLimits,
  favoriteMatches,
  favoritePreviewColor,
  type Settings,
} from "../../light/model";
import { own } from "../../lib/own";
import type { BoardInfo, Favorite, LightStatus } from "../../protocol/types";
import { useSession } from "../board-context";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import { showNotice } from "../notice";
import { EffectPreview } from "./effect-picker";
import { EditDialog, FavoriteSheet, FullDialog, SaveDialog, type Note, type SheetActions } from "./favorite-dialogs";

/** The words of a tile for assistive technology: its name, then what is true of it. */
export function tileName(favorite: Favorite, onNow: boolean, turnsOn: boolean): string {
  return [
    favorite.name,
    onNow ? i18n.t("favorites:tile.onNowName") : null,
    turnsOn ? i18n.t("favorites:tile.turnsOnName") : null,
  ]
    .filter(Boolean)
    .join(i18n.t("favorites:tile.separator"));
}

function Tile({
  favorite,
  onNow,
  turnsOn,
  onApply,
}: {
  favorite: Favorite;
  onNow: boolean;
  turnsOn: boolean;
  onApply: () => void;
}) {
  const { t } = useTranslation("favorites");
  // An effect this app does not know gets a still, neutral dot
  const known = own(EFFECTS, favorite.effect) !== undefined;
  return (
    <button
      type="button"
      data-testid="favorite-tile"
      aria-label={tileName(favorite, onNow, turnsOn)}
      onClick={onApply}
      className={cn(
        "flex min-h-14 items-start gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-base transition-colors hover:bg-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50",
        onNow && "border-primary bg-accent text-accent-foreground ring-2 ring-primary hover:bg-accent",
      )}
    >
      <span className="mt-0.5 flex">
        <EffectPreview
          effect={known ? favorite.effect : ""}
          color={favoritePreviewColor(favorite)}
          testId="favorite-preview"
        />
      </span>
      <span className="min-w-0 grow">
        <span className="line-clamp-2 font-medium [overflow-wrap:anywhere]">{favorite.name}</span>
        {onNow && (
          <span className="flex items-start gap-1 text-sm font-medium">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t("tile.onNow")}
          </span>
        )}
        {turnsOn && (
          <span className={cn("flex items-start gap-1 text-sm", !onNow && "text-muted-foreground")}>
            <Power aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t("tile.turnsOn")}
          </span>
        )}
      </span>
    </button>
  );
}

type Dialog = "save" | "edit" | null;

/** Where the outcome of a request of a dialog is shown: the surface on top when the reply arrives. */
type Surface = "sheet" | "list" | "save" | "page";
/** The dialog or sheet a request came from, and which opening of it: a later opening is another dialog. */
interface Origin {
  kind: "save" | "sheet";
  key: number;
  /** Save only: whether the list was full, so the Full form, not the Save form, sent it. */
  full: boolean;
}

/**
 * The Favorites card: a tile per favorite (one tap applies it), "Save this light" and "Edit". It is drawn only for a
 * board that reports the favorites limits. A lost connection greys it with the rest of the view and closes its dialogs.
 */
export function FavoritesCard({
  info,
  settings,
  light,
  favorites,
  start,
  disabled,
}: {
  info: BoardInfo;
  settings: Settings;
  light: LightStatus;
  favorites: Favorite[];
  start: number | null;
  disabled: boolean;
}) {
  const { t } = useTranslation("favorites");
  const session = useSession();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [sheetId, setSheetId] = useState<number | null>(null);
  /** What the outcome of a request showed in a dialog, and in which. */
  const [note, setNote] = useState<(Note & { surface: Surface }) | null>(null);
  /** The tile pressed while its request is in flight: it shows "On now" at once. */
  const [applying, setApplying] = useState<number | null>(null);
  // What is open now and which opening it is, for a reply that arrives later: the page has moved on by then
  const view = useRef({ dialog: null as Dialog, sheetId: null as number | null, dialogKey: 0, sheetKey: 0 });
  useEffect(() => {
    view.current.dialog = dialog;
    view.current.sheetId = sheetId;
  });
  const limits = favoriteLimits(info);
  const full = favorites.length >= limits.count;
  const sheet = favorites.find((item) => item.id === sheetId) ?? null;
  // A lost connection closes the dialogs; they do not come back with it
  if (disabled && (dialog !== null || sheetId !== null || note !== null)) {
    setDialog(null);
    setSheetId(null);
    setNote(null);
  }
  // A sheet or list whose favorites left the list is closed for good, so a favorite that comes back later with the
  // same id (after a reset) never opens it by itself
  if (sheetId !== null && sheet === null) setSheetId(null);
  if (dialog === "edit" && favorites.length === 0) setDialog(null);
  const openEdit = dialog === "edit" && favorites.length > 0;

  function openDialog(kind: "save" | "edit"): void {
    view.current.dialog = kind;
    view.current.dialogKey++;
    setNote(null);
    setDialog(kind);
  }
  function closeDialog(): void {
    view.current.dialog = null;
    setDialog(null);
  }
  function openSheet(id: number): void {
    view.current.sheetId = id;
    view.current.sheetKey++;
    setNote(null);
    setSheetId(id);
  }
  function closeSheet(): void {
    view.current.sheetId = null;
    setSheetId(null);
  }

  const onNow = (favorite: Favorite): boolean =>
    applying !== null ? favorite.id === applying : light.on && favoriteMatches(favorite, settings, info);

  async function apply(favorite: Favorite): Promise<void> {
    setApplying(favorite.id);
    try {
      if ((await session.applyFavorite(favorite.id)).ok)
        showNotice(message("favorites:done.applied", { name: favorite.name }));
    } finally {
      setApplying(null);
    }
  }

  const fullNow = (): boolean => (session.getState().favorites ?? []).length >= limits.count;
  const originNow = (kind: Origin["kind"]): Origin => ({
    kind,
    key: kind === "save" ? view.current.dialogKey : view.current.sheetKey,
    full: fullNow(),
  });
  /** Whether the dialog or sheet that made a request is still the one that is open. */
  const isOpen = (origin: Origin): boolean =>
    origin.kind === "save"
      ? view.current.dialog === "save" && view.current.dialogKey === origin.key
      : view.current.sheetId !== null &&
        view.current.sheetKey === origin.key &&
        (session.getState().favorites ?? []).some((item) => item.id === view.current.sheetId);

  /** The surface on top now: the sheet, else the list, else the save dialog, else the page. Read from the session, which
   * already knows the list the reply brought: a sheet whose favorite is gone is not on top. */
  function top(): Surface {
    const list = session.getState().favorites ?? [];
    if (view.current.sheetId !== null && list.some((item) => item.id === view.current.sheetId)) return "sheet";
    if (view.current.dialog === "edit" && list.length > 0) return "list";
    return view.current.dialog === "save" ? "save" : "page";
  }

  /** Shows a sentence on the surface on top: a line in its dialog, or the bottom message when no dialog is open. */
  function show(tone: Note["tone"], text: Message): void {
    const surface = top();
    if (surface !== "page") setNote({ surface, tone, text });
    else if (tone === "error") session.showError(text);
    else showNotice(text);
  }

  /**
   * Runs a request of a dialog and puts its outcome on the surface on top when the reply arrives, in one place only.
   * `closes` closes the dialog or sheet that made the request, if it is still the open one: another that was opened
   * meanwhile is none of this request's business. A name problem stays with the field while its form is open.
   */
  async function request(
    kind: Origin["kind"],
    outcome: Promise<FavoriteOutcome>,
    confirmation: Message,
    closes: boolean,
  ): Promise<FavoriteOutcome> {
    const origin = originNow(kind);
    setNote(null);
    const result = await outcome;
    const open = isOpen(origin);
    // The name field that sent the name is still there: the same opening, and for a save the same form (a save can
    // turn into the Full form when the list fills meanwhile)
    const sameForm = open && (kind !== "save" || fullNow() === origin.full);
    if (result.ok) {
      if (closes && open) (kind === "save" ? closeDialog : closeSheet)();
      show("done", confirmation);
    } else if (result.message !== null && !(result.nameProblem && sameForm)) show("error", result.message);
    return result;
  }

  const actions: SheetActions = {
    rename: (favorite, name) =>
      request("sheet", session.renameFavorite(favorite.id, name), message("favorites:done.renamed", { name }), false),
    useNow: (favorite) =>
      request(
        "sheet",
        session.replaceFavorite(favorite.id),
        message("favorites:done.updated", { name: favorite.name }),
        false,
      ),
    setStart: (favorite, on) =>
      request(
        "sheet",
        session.setStartFavorite(on ? favorite.id : null),
        on ? message("favorites:done.startOn", { name: favorite.name }) : message("favorites:done.startOff"),
        false,
      ),
    remove: (favorite) =>
      request(
        "sheet",
        session.deleteFavorite(favorite.id),
        message("favorites:done.deleted", { name: favorite.name }),
        true,
      ),
  };
  const noteFor = (surface: Surface): Note | null => (note?.surface === surface ? note : null);

  return (
    <Card aria-labelledby="favorites-title" className="relative">
      <CardTitle id="favorites-title" className="sm:mb-3 sm:flex sm:min-h-11 sm:items-center">
        {t("card.title")}
      </CardTitle>
      {favorites.length === 0 ? (
        <p className="text-base text-muted-foreground" data-testid="favorites-empty">
          {t("card.empty")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {favorites.map((favorite) => (
            <Tile
              key={favorite.id}
              favorite={favorite}
              onNow={onNow(favorite)}
              turnsOn={start === favorite.id}
              onApply={() => void apply(favorite)}
            />
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2 sm:absolute sm:top-5 sm:right-5 sm:mt-0">
        <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => openDialog("save")}>
          <Plus aria-hidden className="size-5" />
          {t("card.save")}
        </Button>
        {favorites.length > 0 && (
          <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => openDialog("edit")}>
            <Pencil aria-hidden className="size-5" />
            {t("card.edit")}
          </Button>
        )}
      </div>
      <SaveDialog
        open={dialog === "save" && !full}
        onClose={closeDialog}
        info={info}
        favorites={favorites}
        defaultName={defaultFavoriteName(
          effectInfo(settings.effect).label,
          favorites.map((item) => item.name),
          limits.name,
        )}
        note={noteFor("save")}
        onSave={(name) => request("save", session.saveFavorite(name), message("favorites:done.saved", { name }), true)}
      />
      <FullDialog
        open={dialog === "save" && full}
        onClose={closeDialog}
        info={info}
        favorites={favorites}
        note={noteFor("save")}
        onReplace={(favorite) =>
          request(
            "save",
            session.replaceFavorite(favorite.id),
            message("favorites:done.updated", { name: favorite.name }),
            true,
          )
        }
      />
      <EditDialog
        open={openEdit}
        onClose={closeDialog}
        favorites={favorites}
        note={noteFor("list")}
        onOpen={(favorite) => openSheet(favorite.id)}
      />
      <FavoriteSheet
        favorite={sheet}
        start={start}
        favorites={favorites}
        info={info}
        actions={actions}
        note={noteFor("sheet")}
        onClose={closeSheet}
      />
    </Card>
  );
}
