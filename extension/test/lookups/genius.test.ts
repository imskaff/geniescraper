import { describe, expect, it } from "vitest";
import { matchSong } from "../../src/core/geniusMatch";
import { searchGenius } from "../../src/lookups/genius";
import type { GetJson } from "../../src/lookups/itunes";

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

// Trimmed from the live answers for the Apple Music single "Jeżyk! - Single" by "OKI & Nolyrics Beats": Genius lists
// OKI alone as the artist and credits Nolyrics Beats as a producer, and finds nothing for the full Apple artist line.
const hit = (id: number, title: string, primary: string[], path: string): unknown => ({
  type: "song",
  result: { id, title, path, primary_artists: primary.map((name) => ({ name })), featured_artists: [] },
});
const jezyk = hit(7893644, "Jeżyk!", ["OKI"], "/Oki-jezyk-lyrics");
const songPage = (credits: Record<string, string[]>): unknown => ({
  response: {
    song: {
      producer_artists: (credits["producers"] ?? []).map((name) => ({ name })),
      writer_artists: (credits["writers"] ?? []).map((name) => ({ name })),
      featured_artists: [],
      custom_performances: [{ label: "Mixing Engineer", artists: (credits["mixing"] ?? []).map((name) => ({ name })) }],
    },
  },
});

/** A fake Genius: the search answers by exact query text, the song page by id. */
function fakeGenius(
  searches: Record<string, unknown[]>,
  pages: Record<number, unknown>,
): { asked: string[]; get: GetJson } {
  const asked: string[] = [];
  return {
    asked,
    get: (url) => {
      asked.push(url);
      const u = new URL(url);
      const id = /^\/api\/songs\/(\d+)$/.exec(u.pathname)?.[1];
      if (id !== undefined) return Promise.resolve(pages[Number(id)] ?? null);
      return Promise.resolve(answer(searches[u.searchParams.get("q") ?? ""] ?? []));
    },
  };
}

describe("an Apple artist line that lists a producer as a co-artist", () => {
  const searches = { "OKI Jeżyk!": [jezyk] };
  const credited = { 7893644: songPage({ producers: ["Nolyrics Beats", "Paweł Gronek"], writers: ["OKI"] }) };

  it("finds the song when the extra Apple name is credited on the Genius song", async () => {
    const genius = fakeGenius(searches, credited);
    const hits = await searchGenius(genius.get, "Jeżyk!", "OKI & Nolyrics Beats");
    expect(matchSong("Jeżyk!", "OKI & Nolyrics Beats", hits ?? [])).toMatchObject({
      kind: "match",
      song: { id: 7893644, url: "https://genius.com/Oki-jezyk-lyrics" },
    });
  });

  it("stays 'none' when the extra Apple name is not credited anywhere on that Genius song", async () => {
    const genius = fakeGenius(searches, { 7893644: songPage({ producers: ["Paweł Gronek"], writers: ["OKI"] }) });
    const hits = await searchGenius(genius.get, "Jeżyk!", "OKI & Nolyrics Beats");
    expect(matchSong("Jeżyk!", "OKI & Nolyrics Beats", hits ?? [])).toEqual({ kind: "none" });
  });

  it("stays 'none' when the song page cannot be read, and for a different title by the same artist", async () => {
    const down = fakeGenius(searches, {});
    expect(
      matchSong(
        "Jeżyk!",
        "OKI & Nolyrics Beats",
        (await searchGenius(down.get, "Jeżyk!", "OKI & Nolyrics Beats")) ?? [],
      ),
    ).toEqual({ kind: "none" });
    const other = fakeGenius(
      { "OKI Inny": [hit(5, "Inny", ["OKI"], "/Oki-inny-lyrics")] },
      { 5: songPage({ producers: ["Nolyrics Beats"] }) },
    );
    expect(
      matchSong(
        "Jeżyk!",
        "OKI & Nolyrics Beats",
        (await searchGenius(other.get, "Jeżyk!", "OKI & Nolyrics Beats")) ?? [],
      ),
    ).toEqual({ kind: "none" });
  });

  it("asks nothing extra for a single artist, and no song page when the full line already matches", async () => {
    const genius = fakeGenius({ "OKI Jeżyk!": [jezyk] }, credited);
    await searchGenius(genius.get, "Jeżyk!", "OKI");
    expect(genius.asked).toEqual(["https://genius.com/api/search/song?q=OKI+Je%C5%BCyk%21"]);
  });
});

describe("other artist lines with a credited co-artist", () => {
  it.each([
    ["Zażółć gęślą jaźń", "Łódź & Beatmaker", "Łódź", ["Beatmaker"]],
    ["Café del Mar", "Zoé and Mixer Ł", "Zoé", ["Mixer Ł", "Someone Else"]],
    ["Wolność - EP", "Kasia, Producer Ą", "Kasia", ["Producer Ą"]],
  ])("finds %s by %s", async (title, line, lead, producers) => {
    const clean = title.replace(/ - EP$/, "");
    const genius = fakeGenius(
      { [`${lead} ${clean}`]: [hit(9, clean, [lead], "/Some-song-lyrics")] },
      { 9: songPage({ producers }) },
    );
    const hits = await searchGenius(genius.get, clean, line);
    expect(matchSong(clean, line, hits ?? []).kind).toBe("match");
  });
});
