// SPDX-License-Identifier: GPL-3.0-or-later

import { useId, useState, type FormEvent } from "react";
import { useBoard } from "../board-context";
import { Banner } from "../components/banner";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";

/** The token this Zenit asks for before it answers over WiFi. It stays in the page's memory and is never saved. */
export function LoginView() {
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
      <h1 className="text-2xl font-semibold">Log in to your Zenit</h1>
      <Card aria-labelledby="login-title">
        <CardTitle id="login-title">Access to this Zenit</CardTitle>
        <p className="mb-3 text-base">
          This Zenit asks for a token before it lets you control it over WiFi. The token has 16 letters and digits. You
          find it in the Device page when Zenit is connected with the USB cable, or with the command line tool over USB.
        </p>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <div>
            <label htmlFor={id} className="mb-1 block text-base font-medium">
              Token
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
              Zenit never sends the token over WiFi. This page keeps it only until you close it.
            </p>
          </div>
          {board.loginIdle && !board.loginProblem && (
            <Banner tone="info">
              Zenit closed the idle connection after 10 seconds. Type the token and press Log in: this page connects
              again by itself.
            </Banner>
          )}
          {board.loginProblem && <Banner tone="error">{board.loginProblem}</Banner>}
          <Button type="submit" disabled={working}>
            Log in
          </Button>
        </form>
      </Card>
    </>
  );
}
