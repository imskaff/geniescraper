import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCopyright } from "../../src/apple/page";
import { lookupCopyright, type GetJson } from "../../src/lookups/itunes";
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

describe("a /song/ page has no footer; the album's lines come from the iTunes lookup", () => {
  const FIXTURES = join(import.meta.dirname, "..", "..", "..", "tests", "fixtures");
  const read = (file: string): unknown => JSON.parse(readFileSync(join(FIXTURES, "lookups", file), "utf-8"));
  const URL_ = "https://music.apple.com/us/song/trade-places/1878823464";

  it("finds no ℗ or © line on the saved song page", () => {
    const page = readFileSync(join(FIXTURES, "harlow-trade-places.song.html"), "utf-8").replace(
      /<style[\s\S]*?<\/style>|<iframe[\s\S]*?<\/iframe>/gi,
      "",
    );
    expect(readCopyright(new DOMParser().parseFromString(page, "text/html"))).toEqual(["", ""]);
  });

  it("looks up the song, then its album, and yields Atlantic Records / Warner Music Group", async () => {
    const asked: string[] = [];
    const getJson: GetJson = (url) => {
      asked.push(url);
      return Promise.resolve(
        read(url.includes("id=1878823464") ? "itunes-song-trade-places.json" : "itunes-album-monica.json"),
      );
    };
    const [phonographicCopyright, copyrightNotice] = await lookupCopyright(getJson, URL_);
    expect(asked).toEqual([
      "https://itunes.apple.com/lookup?id=1878823464&country=us",
      "https://itunes.apple.com/lookup?id=1878823462&country=us",
    ]);
    expect([phonographicCopyright, copyrightNotice]).toEqual(["℗ 2026 Atlantic Recording Corporation", ""]);
    const info = labelInfo({ phonographicCopyright, credits: [] });
    expect([info.label, info.distributor]).toEqual(["Atlantic Records", "Warner Music Group"]);
  });

  it("gives empty lines when the lookup fails", async () => {
    expect(await lookupCopyright(() => Promise.resolve(null), URL_)).toEqual(["", ""]);
  });
});
