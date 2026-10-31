import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/ui/panel.css"), "utf-8");

/** Every margin, padding and gap declaration, with the rule it sits in. */
function spacing(): { selector: string; property: string; value: string }[] {
  const found: { selector: string; property: string; value: string }[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
    for (const declaration of (rule[2] ?? "").matchAll(
      /(?:^|;|\n)\s*((?:margin|padding|gap|row-gap|column-gap)[\w-]*)\s*:\s*([^;]+)/g,
    )) {
      found.push({ selector, property: declaration[1] ?? "", value: (declaration[2] ?? "").trim() });
    }
  }
  return found;
}

describe("the panel's spacing", () => {
  it("defines one scale of five steps", () => {
    const steps = [...css.matchAll(/--space-(\d):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]);
    expect(steps).toEqual([
      ["1", 4],
      ["2", 8],
      ["3", 12],
      ["4", 16],
      ["5", 24],
    ]);
  });

  it("uses only the scale for every margin, padding and gap", () => {
    const off = spacing().filter(({ selector, value }) => {
      // Screen-reader-only text is clipped with a 1px negative margin on purpose.
      if (selector === ".sr-only" || selector.startsWith(".alert.quiet-visual")) return false;
      const rest = value
        .replace(/var\(--space-\d\)/g, "")
        .replace(/\*\s*-1/g, "")
        .replace(/\b0\b|auto|calc|[()*\s-]/g, "");
      // Whatever is left is a raw length: anything but the 18px checkbox width the option help lines up with.
      return /\d/.test(rest.replace(/18px/g, ""));
    });
    expect(off).toEqual([]);
  });
});
