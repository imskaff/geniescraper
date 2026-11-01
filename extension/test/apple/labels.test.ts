import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCopyright } from "../../src/apple/page";
import { labelInfo, typedQueue, type SongCredits } from "../../src/core/models";

// Saved, script-stripped Apple Music page of https://music.apple.com/us/song/trade-places/1878823464 (album view).
const html = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "tests", "fixtures", "harlow-trade-places.page.html"),
  "utf-8",
)
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<iframe[\s\S]*?<\/iframe>/gi, "");

describe("acceptance: Trade Places by Jack Harlow", () => {
  const [phonographicCopyright, copyrightNotice] = readCopyright(new DOMParser().parseFromString(html, "text/html"));
  const song = { phonographicCopyright, copyrightNotice, credits: [] } as unknown as SongCredits;

  it("reads the ℗ line from the page", () => {
    expect(phonographicCopyright).toBe("℗ 2026 Atlantic Recording Corporation");
  });

  it("yields Label = Atlantic Records and Distributor = Warner Music Group, with sources", () => {
    const info = labelInfo(song);
    expect([info.label, info.distributor]).toEqual(["Atlantic Records", "Warner Music Group"]);
    expect(info.labelSource).toContain("Atlantic Recording Corporation");
  });

  it("pastes them before the copyright rows", () => {
    expect(typedQueue(song, { includeAdditional: false }).slice(0, 5)).toEqual([
      ["role", "Label"],
      ["artist", "Atlantic Records"],
      ["role", "Distributor"],
      ["artist", "Warner Music Group"],
      ["copyright_role", "Phonographic Copyright"],
    ]);
  });
});
