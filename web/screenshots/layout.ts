// SPDX-License-Identifier: GPL-3.0-or-later

// The layout rules of docs/web/web-app-v1.md#tests, run in the page, shared by the layout checks of every state
// (layout.spec.ts) and the test that shows each rule failing (e2e/layout-rules.spec.ts).

import type { Page } from "@playwright/test";

export interface Problem {
  rule: string;
  element: string;
}

/** The layout rules, run in the page. Returns the elements that break them. */
export async function layoutProblems(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const problems: Array<{ rule: string; element: string }> = [];
    const describe = (element: Element): string =>
      `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""} "${(element.textContent ?? "").trim().slice(0, 40)}"`;
    const visible = (element: Element): boolean => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      problems.push({
        rule: "the page scrolls sideways",
        element: `${root.scrollWidth} px of content in ${root.clientWidth} px`,
      });
    }
    for (const element of document.body.querySelectorAll("*")) {
      if (!visible(element) || element.closest(".sr-only") || element.classList.contains("sr-only")) continue;
      const box = element.getBoundingClientRect();
      // The dialog's overlay and the scroll lock are the window itself
      if (box.left < -1 || box.right > root.clientWidth + 1) {
        problems.push({ rule: "an element reaches outside the window", element: describe(element) });
      }
    }
    // Text cut by its box: clipped or ended with an ellipsis (a longer language must still fit its control)
    for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
      if (!visible(element) || element.closest(".sr-only")) continue;
      const style = getComputedStyle(element);
      if (style.overflowX === "visible" && style.textOverflow !== "ellipsis") continue;
      if (style.overflowX === "auto" || style.overflowX === "scroll") continue;
      const ownText = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
      );
      if (ownText && element.scrollWidth > element.clientWidth + 1)
        problems.push({ rule: "a text is cut", element: describe(element) });
    }
    const targets = document.querySelectorAll<HTMLElement>(
      "button, a[href], input:not(.sr-only), select, textarea, label:has(input), summary",
    );
    for (const element of targets) {
      if (!visible(element)) continue;
      // A link inside a sentence is as high as the line; a slider is its whole track, not its thumb
      if (element.matches("a") && element.closest("p")) continue;
      // A checkbox or radio button is as large as the label around it, which is the target
      if (element.matches("input") && element.closest("label")) continue;
      const box = element.getBoundingClientRect();
      if (box.height < 43.5 || box.width < 43.5) {
        problems.push({
          rule: "a control is smaller than 44 px",
          element: `${describe(element)} ${Math.round(box.width)}x${Math.round(box.height)}`,
        });
      }
    }
    for (const slider of document.querySelectorAll<HTMLElement>("[role=slider]")) {
      const track = slider.closest(".touch-none")?.getBoundingClientRect();
      if (track && track.height < 43.5)
        problems.push({ rule: "a slider is shorter than 44 px", element: describe(slider) });
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      "button, a[href], input, select, textarea, [role=slider], summary",
    )) {
      if (!visible(element) && !element.matches("input.sr-only")) continue;
      const labelled = element.getAttribute("aria-labelledby");
      const name =
        element.getAttribute("aria-label") ??
        (labelled ? document.getElementById(labelled)?.textContent : null) ??
        (element.id ? document.querySelector(`label[for="${element.id}"]`)?.textContent : null) ??
        element.closest("label")?.textContent ??
        element.textContent;
      if (!name || name.trim() === "")
        problems.push({ rule: "a control has no accessible name", element: describe(element) });
    }
    return problems;
  });
}
