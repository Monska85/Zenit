// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { frameRequest, parseLine } from "../src/protocol/frame";
import { text } from "./helpers";

const decode = (line: Uint8Array): string => new TextDecoder().decode(line);

describe("frameRequest", () => {
  it("makes the info request of the specification", () => {
    expect(decode(frameRequest({ seq: 1, cmd: "info" }))).toBe('@ZN 3c250228 {"seq":1,"cmd":"info"}');
  });

  it("keeps the order of the fields and writes their values as JSON", () => {
    const line = decode(frameRequest({ seq: 9, cmd: "settings_set", effect: "breathing", colors: ["red", "blue"] }));
    expect(line).toMatch(
      /^@ZN [0-9a-f]{8} \{"seq":9,"cmd":"settings_set","effect":"breathing","colors":\["red","blue"\]\}$/,
    );
  });

  it("has no newline", () => {
    expect(decode(frameRequest({ seq: 1, cmd: "info", text: "a\nb" }))).not.toContain("\n");
  });

  it("reads back as the same object", () => {
    expect(parseLine(frameRequest({ seq: 3, cmd: "light", on: true }))).toEqual({ seq: 3, cmd: "light", on: true });
  });
});

describe("parseLine", () => {
  const good = '@ZN 3c250228 {"seq":1,"cmd":"info"}';

  it("reads a line", () => {
    expect(parseLine(text(good))).toEqual({ seq: 1, cmd: "info" });
  });

  it("ignores a newline, and one carriage return before it", () => {
    expect(parseLine(text(good + "\n"))).not.toBeNull();
    expect(parseLine(text(good + "\r\n"))).not.toBeNull();
    expect(parseLine(text(good + "\r"))).not.toBeNull();
  });

  it("throws away a second carriage return", () => {
    expect(parseLine(text(good + "\r\r\n"))).toBeNull();
  });

  it.each([
    ["log text", "zenit: firmware 1.0.0 on esp32c3"],
    ["an empty line", ""],
    ["the marker alone", "@ZN"],
    ["the marker and a space", "@ZN "],
    ["a lower case marker", good.replace("@ZN", "@zn")],
    ["a leading space", " " + good],
    ["a double marker", "@" + good],
    ["no marker", '{"seq":1,"cmd":"info"}'],
    ["a wrong checksum", good.replace("3c250228", "3c250229")],
    ["a short checksum", good.replace("3c250228", "3c25022")],
    ["a long checksum", good.replace("3c250228", "03c250228")],
    ["an upper case checksum", '@ZN 3C250228 {"seq":1,"cmd":"info"}'],
    ["a non-hex checksum", good.replace("3c250228", "3c25022g")],
    ["no space after the checksum", good.replace("3c250228 ", "3c250228x")],
    ["a checksum of other bytes", '@ZN 3c250228 {"seq":2,"cmd":"info"}'],
    ["a comment with a correct checksum", '@ZN 9b512356 {"seq":1,"cmd":"info"} // c'],
    ["a key twice with a correct checksum", '@ZN c6b49e6a {"seq":1,"cmd":"info","cmd":"settings_reset"}'],
  ])("throws away %s", (_name, line) => {
    expect(parseLine(text(line))).toBeNull();
  });

  it("throws away invalid UTF-8 with a correct checksum", () => {
    const body = Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]);
    const line = new Uint8Array([...text("@ZN "), ...text("00000000 "), ...body]);
    expect(parseLine(line)).toBeNull();
  });
});
