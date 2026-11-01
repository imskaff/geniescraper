// @vitest-environment jsdom
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
});
