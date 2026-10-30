import { describe, expect, it } from "vitest";
import { searchGenius } from "../../src/lookups/genius";

const answer = (hits: unknown[]): unknown => ({ response: { sections: [{ type: "song", hits }] } });
const song = { type: "song", result: { id: 1, title: "Fortnight", path: "/Taylor-swift-fortnight-lyrics" } };

describe("searchGenius", () => {
  it("asks Genius's song search for the artist and the title without the featured part", async () => {
    const urls: string[] = [];
    const hits = await searchGenius(
      (url) => {
        urls.push(url);
        return Promise.resolve(answer([song]));
      },
      "Fortnight (feat. Post Malone)",
      "Taylor Swift",
    );
    expect(urls).toEqual(["https://genius.com/api/search/song?q=Taylor+Swift+Fortnight"]);
    expect(hits?.map((hit) => hit.id)).toEqual([1]);
  });

  it("gives an empty list for a real answer with no songs, so 'no match' can be said", async () => {
    expect(await searchGenius(() => Promise.resolve(answer([])), "x", "y")).toEqual([]);
  });

  it("gives null when Genius could not be asked or answered with something else", async () => {
    expect(await searchGenius(() => Promise.resolve(null), "x", "y")).toBeNull();
    expect(await searchGenius(() => Promise.resolve("<html>challenge</html>"), "x", "y")).toBeNull();
    expect(await searchGenius(() => Promise.resolve({ meta: { status: 403 } }), "x", "y")).toBeNull();
    expect(await searchGenius(() => Promise.resolve({ response: {} }), "x", "y")).toBeNull();
  });

  it("does not ask for an empty query", async () => {
    let asked = 0;
    const result = await searchGenius(
      () => {
        asked++;
        return Promise.resolve(answer([]));
      },
      "(feat. X)",
      "",
    );
    expect(result).toBeNull();
    expect(asked).toBe(0);
  });
});
