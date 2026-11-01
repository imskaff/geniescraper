import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTHOR_URL, SUPPORT_URL, footer } from "../../src/ui/footer";

describe("footer", () => {
  it("links the author and the coffee page, each in a new tab", () => {
    const links = [...footer().querySelectorAll("a")];
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["imskaff", AUTHOR_URL],
      ["buy me a coffee", SUPPORT_URL],
    ]);
    for (const a of links) expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("is pushed to the bottom edge: the page is a column as tall as the panel and the credit takes the spare room", () => {
    const css = readFileSync(join(import.meta.dirname, "..", "..", "src", "ui", "panel.css"), "utf8");
    expect(css).toMatch(/\nbody \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 100vh;/);
    expect(css).toMatch(/\n#app \{[^}]*flex: 1 0 auto;/);
    expect(css).toMatch(/\n\.credit \{[^}]*margin: auto auto 0;/);
  });
});
