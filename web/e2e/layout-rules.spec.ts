// SPDX-License-Identifier: GPL-3.0-or-later

// Each rule of the layout checks (screenshots/layout.ts) fails on a page that breaks it, and a page that keeps them
// passes: otherwise a rule that stopped working would let every state through.

import { expect, test } from "@playwright/test";
import { layoutProblems } from "../screenshots/layout.ts";

const page = (body: string): string => `<!doctype html><html><body style="margin:0">${body}</body></html>`;

test.use({ viewport: { width: 360, height: 640 } });

test("a good page has no problem", async ({ page: browser }) => {
  await browser.setContent(
    page(`<main><button style="height:44px;width:100px">Go</button><a href="#" style="display:inline-block;height:44px;width:60px">Link</a>
    <label style="display:block;height:44px"><input type="checkbox"> Yes</label></main>`),
  );
  expect(await layoutProblems(browser)).toEqual([]);
});

test("a page that scrolls sideways is reported, with the element that reaches out", async ({ page: browser }) => {
  await browser.setContent(page('<div style="width:500px;height:50px">wide</div>'));
  const rules = (await layoutProblems(browser)).map((problem) => problem.rule);
  expect(rules).toContain("the page scrolls sideways");
  expect(rules).toContain("an element reaches outside the window");
});

test("a control under 44 px is reported", async ({ page: browser }) => {
  await browser.setContent(
    page(
      '<button style="height:30px;width:100px">Small</button><a href="#" style="display:block;height:20px">Tiny</a>',
    ),
  );
  const problems = await layoutProblems(browser);
  expect(problems.filter((problem) => problem.rule === "a control is smaller than 44 px")).toHaveLength(2);
});

test("a link inside a sentence is as high as its line, and is let through", async ({ page: browser }) => {
  await browser.setContent(page('<p>Read <a href="#">this</a> first.</p>'));
  expect(await layoutProblems(browser)).toEqual([]);
});

test("a control with no accessible name is reported", async ({ page: browser }) => {
  await browser.setContent(page('<button style="height:44px;width:44px"></button>'));
  expect((await layoutProblems(browser)).map((problem) => problem.rule)).toContain("a control has no accessible name");
});

test("a slider track under 44 px is reported", async ({ page: browser }) => {
  await browser.setContent(
    page(
      '<span class="touch-none" style="display:block;height:20px"><span role="slider" aria-label="Level" style="display:block;height:20px"></span></span>',
    ),
  );
  expect((await layoutProblems(browser)).map((problem) => problem.rule)).toContain("a slider is shorter than 44 px");
});

test("a text cut by its box is reported, and a text that fits is let through", async ({ page: browser }) => {
  await browser.setContent(
    page(`<p style="width:80px;overflow:hidden;white-space:nowrap">A sentence much longer than its box</p>
    <p style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Another long sentence here</p>
    <p style="width:200px;overflow:hidden;white-space:nowrap">Fits</p>`),
  );
  const cut = (await layoutProblems(browser)).filter((problem) => problem.rule === "a text is cut");
  expect(cut).toHaveLength(2);
});
