import { describe, expect, it } from "vitest";
import { buildSong } from "../../src/ui/controller";
import { ALBUM, scrapeFor } from "./fakes";

describe("the cover of a track's song", () => {
  const result = { url: ALBUM.trackUrls[0] ?? "" };

  it("is the album's exact cover when there is one, even if the song page shows another image", () => {
    const song = buildSong({ ...ALBUM, coverArtUrl: "https://album/1000x1000bb.png" }, result, {
      ...scrapeFor("One"),
      coverArtUrl: "https://song-page/other.png",
    });
    expect(song.coverArtUrl).toBe("https://album/1000x1000bb.png");
  });

  it("falls back to the song page's header when the album has none", () => {
    const song = buildSong({ ...ALBUM, coverArtUrl: "" }, result, {
      ...scrapeFor("One"),
      coverArtUrl: "https://song-page/c.png",
    });
    expect(song.coverArtUrl).toBe("https://song-page/c.png");
  });

  it("is empty when neither has one, and then the queue has no cover step", () => {
    const song = buildSong({ ...ALBUM, coverArtUrl: "" }, result, scrapeFor("One"));
    expect(song.coverArtUrl).toBe("");
  });
});
