// SPDX-License-Identifier: GPL-3.0-or-later

/** What a page shown inside another site's page says instead of the app. */
export function FramedNotice() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-8">
      <h1 className="text-2xl font-semibold">Zenit</h1>
      <p className="text-base" data-testid="framed-notice">
        The Zenit app works only in its own browser tab, not inside another page.
      </p>
      <p className="text-base">
        <a
          className="inline-flex min-h-11 items-center font-medium text-primary underline"
          href={location.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open the Zenit app in its own tab
        </a>
      </p>
    </main>
  );
}
