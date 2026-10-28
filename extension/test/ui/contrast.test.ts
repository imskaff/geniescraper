import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Holds the stylesheet's colors to WCAG 2.2 AA: 4.5:1 for text, 3:1 for the edges of controls and focus rings.
const CSS = readFileSync(join(import.meta.dirname, "..", "..", "src", "ui", "panel.css"), "utf-8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1] ?? "", m[2] ?? ""]));
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const dark = tokens(CSS.slice(0, CSS.indexOf("@media (prefers-color-scheme: light)")));
const lightBlock = CSS.slice(CSS.indexOf("@media (prefers-color-scheme: light)"));
const light = { ...dark, ...tokens(lightBlock.slice(0, lightBlock.indexOf("}\n}") + 3)) };

// [foreground, background, minimum ratio, what it is]
const PAIRS: readonly [string, string, number, string][] = [
  ["text", "bg", 4.5, "body text"],
  ["text", "surface", 4.5, "text on cards"],
  ["text", "surface-hi", 4.5, "text in inputs and on hover"],
  ["muted", "bg", 4.5, "help text"],
  ["muted", "surface", 4.5, "help text on cards"],
  ["muted", "surface-hi", 4.5, "help text on hover"],
  ["accent-ink", "accent", 4.5, "primary button text"],
  ["accent-ink", "accent-hover", 4.5, "primary button text on hover"],
  // The automatic button's gradient flows through every one of these, so its text must read on each.
  ["accent-ink", "magic-1", 4.5, "automatic button text on the first gradient colour"],
  ["accent-ink", "magic-2", 4.5, "automatic button text on the second gradient colour"],
  ["accent-ink", "magic-3", 4.5, "automatic button text on the third gradient colour"],
  ["accent-ink", "magic-4", 4.5, "automatic button text on the fourth gradient colour"],
  ["danger", "bg", 4.5, "error text"],
  ["danger", "surface", 4.5, "error text on cards"],
  ["ok", "bg", 4.5, "success text"],
  ["ok", "surface", 4.5, "success text on cards"],
  ["warn", "bg", 4.5, "needs-a-look text"],
  ["warn", "surface", 4.5, "needs-a-look text on cards"],
  ["link", "bg", 4.5, "links"],
  ["link", "surface", 4.5, "links on cards"],
  ["nav", "bg", 4.5, "the main menu button"],
  ["nav", "surface-hi", 4.5, "the main menu button on hover"],
  ["control-border", "bg", 3, "control edges"],
  ["control-border", "surface-hi", 3, "input edges"],
  ["focus", "bg", 3, "focus ring on the page"],
  // The focus ring is offset outside controls, so it is always drawn on the page background.
  ["link", "bg", 3, "selected track edge"],
];

describe.each([
  ["dark", dark],
  ["light", light],
] as const)("%s scheme contrast", (_name, scheme) => {
  it.each(PAIRS)("%s on %s is at least %f:1 (%s)", (foreground, background, minimum) => {
    const fg = scheme[foreground];
    const bg = scheme[background];
    expect(fg, `token ${foreground}`).toBeDefined();
    expect(bg, `token ${background}`).toBeDefined();
    expect(contrast(fg ?? "#000000", bg ?? "#000000")).toBeGreaterThanOrEqual(minimum);
  });
});

describe("contrast helper", () => {
  it("matches the known extremes", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#777777")).toBe(1);
  });
});
