import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { brandNodes } from "../../src/ui/brand";
import { el } from "../../src/ui/dom";
import { contrast } from "./contrast.test";

const CSS = readFileSync(join(import.meta.dirname, "..", "..", "src", "ui", "panel.css"), "utf-8");

describe("brand colors", () => {
  it("wraps each provider name in its class and keeps the other words plain", () => {
    const nodes = brandNodes("From Apple Music or Spotify's page");
    expect(nodes.map((n) => n.textContent)).toEqual(["From ", "Apple Music", " or ", "Spotify", "'s page"]);
    expect(nodes.map((n) => (n instanceof HTMLElement ? n.className : ""))).toEqual([
      "",
      "brand-apple",
      "",
      "brand-spotify",
      "",
    ]);
  });

  it("colors names in element text and children without changing textContent or using markup", () => {
    const node = el("p", { text: "Paste an Apple Music <b>link</b>" }, " or Spotify");
    expect(node.textContent).toBe("Paste an Apple Music <b>link</b> or Spotify");
    expect(node.querySelector("b")).toBeNull();
    expect(node.querySelector(".brand-apple")?.textContent).toBe("Apple Music");
    expect(node.querySelector(".brand-spotify")?.textContent).toBe("Spotify");
  });

  it("defines both exact colors as tokens", () => {
    expect(CSS).toMatch(/--brand-apple:\s*#fa5068/);
    expect(CSS).toMatch(/--brand-spotify:\s*#1dda63/);
  });

  it("reads as AA text on the dark backgrounds", () => {
    for (const [color, bg] of [
      ["#fa5068", "#0d0d0c"],
      ["#fa5068", "#171715"],
      ["#1dda63", "#0d0d0c"],
      ["#1dda63", "#171715"],
    ] as const) {
      expect(contrast(color, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
