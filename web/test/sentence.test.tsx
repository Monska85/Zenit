// SPDX-License-Identifier: GPL-3.0-or-later

// A translated sentence with elements inside it: one catalog string, cut at its placeholders
// (src/ui/components/sentence.tsx).

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { i18n } from "../src/i18n";
import { Sentence, slot } from "../src/ui/components/sentence";

describe("Sentence", () => {
  it("puts each element where its placeholder is, in the language's own order", () => {
    const text = i18n.t("privacy:about.licenseLine", { license: slot("license"), permission: slot("permission") });
    const html = renderToStaticMarkup(
      <Sentence text={text} parts={{ license: <a href="./LICENSE.txt">L</a>, permission: <a href="./X.txt">P</a> }} />,
    );
    expect(html).toBe('<a href="./LICENSE.txt">L</a> and <a href="./X.txt">P</a>');
    const reversed = renderToStaticMarkup(
      <Sentence text={`${slot("b")} after ${slot("a")}.`} parts={{ a: <b>A</b>, b: <i>B</i> }} />,
    );
    expect(reversed).toBe("<i>B</i> after <b>A</b>.");
  });

  it("keeps other values as text, escaped by React", () => {
    const text = i18n.t("common:status.connectedWifiTo", { name: slot("name") });
    expect(renderToStaticMarkup(<Sentence text={text} parts={{ name: <span>{"<zenit-a1b2>"}</span> }} />)).toBe(
      "Connected over WiFi to <span>&lt;zenit-a1b2&gt;</span>.",
    );
    expect(renderToStaticMarkup(<Sentence text="No slot here." parts={{}} />)).toBe("No slot here.");
  });
});
