// SPDX-License-Identifier: GPL-3.0-or-later

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { translate } from "../../i18n";
import { useBoard } from "../board-context";
import { Banner } from "../components/banner";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import type { Route } from "../route";

/** The token this Zenit asks for before it answers over WiFi. It stays in the page's memory and is never saved. */
export function LoginView({ go }: { go: (route: Route) => void }) {
  const { t } = useTranslation("connect");
  const { board, session } = useBoard();
  const [token, setToken] = useState("");
  const [working, setWorking] = useState(false);
  const id = useId();
  const hintId = useId();

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setWorking(true);
    try {
      await session.submitToken(token);
      setToken("");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("login.title")}</h1>
      <Card aria-labelledby="login-title">
        <CardTitle id="login-title">{t("login.cardTitle")}</CardTitle>
        <p className="mb-3 text-base">{t("login.text")}</p>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <div>
            <label htmlFor={id} className="mb-1 block text-base font-medium">
              {t("login.token")}
            </label>
            <input
              id={id}
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={token}
              maxLength={16}
              disabled={working}
              onChange={(event) => setToken(event.target.value.toLowerCase())}
              aria-describedby={hintId}
              className="block min-h-11 w-full rounded-xl border border-border bg-background px-3 font-mono text-base disabled:opacity-50"
            />
            <p id={hintId} className="mt-1 text-sm text-muted-foreground">
              {t("login.tokenHint")}
            </p>
          </div>
          {board.loginIdle && !board.loginProblem && <Banner tone="info">{t("login.idle")}</Banner>}
          {board.loginProblem && <Banner tone="error">{translate(board.loginProblem)}</Banner>}
          <Button type="submit" disabled={working}>
            {t("login.submit")}
          </Button>
        </form>
        {/* A page a Zenit served has only that Zenit to talk to */}
        {!board.served && (
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              void session.disconnect();
              go("connect");
            }}
          >
            {t("login.another")}
          </Button>
        )}
      </Card>
    </>
  );
}
