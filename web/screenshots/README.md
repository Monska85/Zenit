# Reference screenshots

`views.spec.ts` compares one image per state of `states.ts` with the files in `baselines/`: every state at 360 px (phone) and 1,280 px (desktop) wide in the light theme, and the states marked `dark` in the dark theme too. Any visible difference fails. Text is only drawn the same way by the same browser build and fonts, so these run inside the official Playwright container, never directly:

- `just web-screenshots` (or `make web-screenshots`) builds the app and compares. A failure leaves the expected, actual and diff images in `web/test-results-screenshots/`.
- `just web-screenshots-update` draws the reference images again. Look at the new images before committing them: a changed image is a changed layout.

Docker is needed. The container is the Playwright image of the pinned `@playwright/test` version (`mcr.microsoft.com/playwright:v<version>-noble`). The repository is mounted into it, and the scripted board of each state needs no simulator. The reference images are drawn on x86-64.

`layout.spec.ts` runs the same states without reference images, on the host, as part of `just web-e2e`: no sideways scroll, nothing outside the window, every control at least 44 px high with an accessible name.

To add a state, add an entry to `states.ts`: both suites pick it up.
