// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Tells which of several overlapping commits of the same setting is the latest. A commit that finishes after a later one
 * for the same setting has started must not clear what the later one is still showing.
 */
export class CommitTracker {
  private readonly latest = new Map<string, number>();
  private count = 0;

  /** Starts a commit of these settings. The function it returns, called when the commit ends, gives the settings for
   * which it was still the latest, and forgets them. */
  start(keys: string[]): () => string[] {
    const id = ++this.count;
    for (const key of keys) this.latest.set(key, id);
    return () =>
      keys.filter((key) => {
        if (this.latest.get(key) !== id) return false;
        this.latest.delete(key);
        return true;
      });
  }
}
