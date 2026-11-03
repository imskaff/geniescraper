import { describe, expect, it } from "vitest";
import { appleAlbumHit, appleAlbumUrl, searchAppleAlbums } from "../../src/lookups/albumLinks";

const album = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  wrapperType: "collection",
  collectionType: "Album",
  collectionId: 1560734944,
  collectionName: "SOUR",
  artistName: "Olivia Rodrigo",
  trackCount: 11,
  releaseDate: "2021-05-21T07:00:00Z",
  collectionExplicitness: "cleaned",
  ...over,
});

describe("searchAppleAlbums", () => {
  it("asks iTunes's US search for albums only, with the text as one encoded parameter", async () => {
    const asked: string[] = [];
    const albums = await searchAppleAlbums((url) => {
      asked.push(url);
      return Promise.resolve({ results: [album()] });
    }, "SOUR Olivia Rodrigo");
    const url = new URL(asked[0] ?? "");
    expect(url.origin + url.pathname).toBe("https://itunes.apple.com/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      term: "SOUR Olivia Rodrigo",
      media: "music",
      entity: "album",
      country: "us",
      limit: "25",
    });
    expect(albums).toEqual([
      { id: "1560734944", title: "SOUR", artist: "Olivia Rodrigo", year: "2021", tracks: 11, explicitness: "cleaned" },
    ]);
  });

  it("keeps a term that tries to add parameters inside the term", async () => {
    let asked = "";
    await searchAppleAlbums((url) => {
      asked = url;
      return Promise.resolve({ results: [] });
    }, "x&country=jp#frag");
    expect(new URL(asked).searchParams.get("term")).toBe("x&country=jp#frag");
    expect(new URL(asked).searchParams.get("country")).toBe("us");
  });

  it("does not ask for an empty query", async () => {
    let asked = false;
    expect(
      await searchAppleAlbums(() => {
        asked = true;
        return Promise.resolve(null);
      }, "   "),
    ).toBeNull();
    expect(asked).toBe(false);
  });

  it("says null (could not ask) for an answer that is not a list, and an empty list for no results", async () => {
    expect(await searchAppleAlbums(() => Promise.resolve(null), "x")).toBeNull();
    expect(await searchAppleAlbums(() => Promise.resolve({ results: "nope" }), "x")).toBeNull();
    expect(await searchAppleAlbums(() => Promise.resolve("<html>blocked</html>"), "x")).toBeNull();
    expect(await searchAppleAlbums(() => Promise.resolve({ resultCount: 0, results: [] }), "x")).toEqual([]);
  });

  it("skips records that are not albums or are malformed, and reads a missing size or date as unknown", async () => {
    const albums = await searchAppleAlbums(
      () =>
        Promise.resolve({
          results: [
            { wrapperType: "track", kind: "song", trackId: 1, trackName: "x", artistName: "y" },
            album({ collectionId: "1560734944" }),
            album({ collectionId: -4 }),
            album({ collectionId: 1.5 }),
            album({ collectionName: 7 }),
            album({ artistName: undefined }),
            "text",
            null,
            album({
              collectionId: 2,
              trackCount: undefined,
              releaseDate: undefined,
              collectionExplicitness: undefined,
            }),
          ],
        }),
      "x",
    );
    expect(albums).toEqual([
      { id: "2", title: "SOUR", artist: "Olivia Rodrigo", year: "", tracks: 0, explicitness: "" },
    ]);
  });
});

describe("the address of a found album", () => {
  it("is built from the id alone, never taken from the answer", () => {
    expect(appleAlbumUrl("1560734944")).toBe("https://music.apple.com/us/album/1560734944");
    expect(
      appleAlbumHit({
        id: "1560734944",
        title: "SOUR",
        artist: "Olivia Rodrigo",
        year: "2021",
        tracks: 11,
        explicitness: "",
      }),
    ).toMatchObject({ href: "https://music.apple.com/us/album/1560734944", artists: ["Olivia Rodrigo"] });
  });
});
