import { describe, expect, it } from "vitest";
import { tabChangeNeedsRefresh } from "../../src/ui/tabEvents";

describe("tabChangeNeedsRefresh", () => {
  it("refreshes on a new address, a finished load and a new title", () => {
    expect(tabChangeNeedsRefresh({ url: "https://open.spotify.com/album/x" })).toBe(true);
    expect(tabChangeNeedsRefresh({ status: "complete" })).toBe(true);
    expect(tabChangeNeedsRefresh({ title: "Song • Artist" })).toBe(true);
  });

  it("ignores changes that say nothing about the page", () => {
    expect(tabChangeNeedsRefresh({ status: "loading" })).toBe(false);
    expect(tabChangeNeedsRefresh({})).toBe(false);
  });
});
