# 7. Translations of the web app

Date: 2026-11-28

Status: accepted; amends the language of the UI in [ADR 0003](0003-web-app.md)

## Context

The web app was written in English, with its text in components, in the models that make sentences (the light, the device settings, WiFi, updates) and in the connection session. The first units go to Italian families, and more languages may follow. English stays the source language and the default; adding a language must be a matter of adding its catalog files, with no code change beyond naming it.

The constraints that shape this decision:

- The app sends nothing to any outside server ([ADR 0003](0003-web-app.md) decision 9), and the same files are served by the board from its 512 KB `www` partition ([ADR 0005](0005-web-app-partition.md)).
- The initial JavaScript has a budget of 150 KB gzip, and the first screen must not wait for a request to show text.
- Text from the board and from the person (board names, favorite names) is shown as React text, never as HTML.
- A key that does not exist must be found by the build, not by a person reading the screen.

## Decision

1. **i18next with react-i18next,** and no other i18next plugin: no HTTP backend, no language detector, no ICU message format. i18next's own `{{placeholder}}` interpolation and its plural keys (`_one`, `_other` and the other categories of `Intl.PluralRules`) cover every sentence of the app.
2. **Catalogs** are JSON files in `web/src/locales/<language>/<namespace>.json`, one per namespace: `common`, `connect`, `light`, `favorites`, `device`, `errors`, `privacy`. A language is its folder; the folder names the language by its primary subtag (`en`, `it`).
3. **Typed keys.** The English catalogs are the type of the resources (`CustomTypeOptions`), so a wrong key or namespace is a TypeScript error.
4. **English is bundled** in the initial chunk and the instance is ready before the first render. **Another language is its own chunk,** loaded with a dynamic import from the app's own files only when it is chosen. Nothing is fetched from another site.
5. **The language order:** the person's saved choice, then the browser's languages in order by primary subtag (`it-CH` gives Italian), then English. A key missing in a language falls back to English.
6. **Text kept for later is a key.** A sentence held in state (the session's error and login problem, the bottom message, a dialog's note) is stored as its key and values and translated where it is shown, so a change of language reaches a message already on the screen.
7. **No markup in a translation** and no `Trans` component: a sentence around a link is split into keys around the link's text. Values from the board or the person go in as interpolation values and are rendered as React text; i18next does not escape them (`escapeValue: false`) because React does.
8. **What is not translated:** the board's own text (names it reports), protocol identifiers, the raw POSIX time zone string, the city names of the time zone table, and log output. An effect, palette, color or pattern a catalog does not have shows the board's id in words, as before.
9. **Numbers and dates** go through `Intl` with the active language. Times of day stay `HH:MM` on a 24-hour clock, as the board stores them.
10. **A test checks every language folder** against English: the same files, the same keys, every plural form of the language, the same placeholders per key, no empty text and no markup. A new language is checked with no new test code.

## Rejected options

- **A small translation layer of our own.** Fewer bytes, but plural rules, interpolation, fallbacks, typed keys and React bindings would all be ours to write and keep correct.
- **Lingui.** Good typing and small catalogs, but it compiles messages with a build plugin and extracts them from the source with its own tools, a second toolchain for a project of this size.
- **The i18next HTTP backend.** Catalogs would be requests at run time, against the rule of no request but the app's own files, and the first screen would wait for one. Dynamic imports load the same files as part of the build.
- **The i18next browser language detector.** It reads cookies, the query string and storage keys of its own; the order the app needs is three lines over `navigator.languages` and one stored value.

## Consequences

- Adding a language is adding its folder of catalogs and its name in the language choice; the test then checks it.
- Every string of the app is in a catalog, so a wording change is a catalog change, and the English catalogs are the source every translation follows.
- The initial JavaScript grows by i18next, react-i18next and the English catalogs; another language costs nothing until it is chosen.
- Translated text lives only in `web/src/locales/<language>/` and in the tests that check it; the rest of the repository stays English ([AGENTS.md](../../AGENTS.md)).
