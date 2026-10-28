import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  audioQueries,
  descriptionBonus,
  descriptionOf,
  extractVar,
  findYoutube,
  isArtistChannel,
  listVideos,
  mvQueries,
  namesArtist,
  scoreAudio,
  scoreLyric,
  scoreMv,
  sigPresent,
  titleMatchesSong,
  type YoutubePages,
} from "../../src/lookups/youtube";

/** The most requests one song may cost, and the average over the golden set. The desktop algorithm needs up to 18. */
const MAX_REQUESTS_PER_SONG = 6;
const AVERAGE_REQUESTS_PER_SONG = 4.5;

const TESTS = join(import.meta.dirname, "..", "..", "..", "tests");

interface Golden {
  id: string;
  title: string;
  artist: string;
  video_id: string;
  is_music_video: boolean;
  accept: string[];
}
interface Fixture {
  searches: Record<string, unknown>;
  watch: Record<string, unknown>;
}

const golden = JSON.parse(readFileSync(join(TESTS, "golden", "youtube.json"), "utf-8")) as Golden[];
const fixture = (id: string): Fixture =>
  JSON.parse(readFileSync(join(TESTS, "fixtures", "lookups", "youtube", `${id}.json`), "utf-8")) as Fixture;

/** The saved pages, answered as the live site does for something it has no page for: nothing. */
function savedPages(id: string, log: string[] = []): YoutubePages {
  const saved = fixture(id);
  return {
    search: (query) => {
      log.push(`search:${query}`);
      return Promise.resolve(saved.searches[query] ?? null);
    },
    watch: (videoId) => {
      log.push(`watch:${videoId}`);
      return Promise.resolve(saved.watch[videoId] ?? null);
    },
  };
}

describe("finding a link, replaying the saved YouTube pages", () => {
  it.each(golden.map((g) => [g.id, g] as const))(
    "%s gives a verified video with the right music-video flag",
    async (_id, g) => {
      const link = await findYoutube(savedPages(g.id), g.title, g.artist);
      const id = link.url.split("=").pop() ?? "";
      expect(g.accept, link.url).toContain(id);
      expect(link.isMusicVideo).toBe(g.is_music_video);
      expect(link.url).toBe(`https://www.youtube.com/watch?v=${id}`);
    },
  );

  it("makes the same requests the desktop app does for a song with a music video (a bounded number)", async () => {
    const log: string[] = [];
    const g = golden.find((x) => x.id === "eilish-hmhas-t3");
    if (!g) throw new Error("missing golden case");
    await findYoutube(savedPages(g.id, log), g.title, g.artist);
    const searches = log.filter((l) => l.startsWith("search:"));
    const watches = log.filter((l) => l.startsWith("watch:"));
    expect(searches.length).toBeLessThanOrEqual(
      audioQueries(g.title, g.artist).length + mvQueries(g.title, g.artist).length,
    );
    expect(watches.length).toBeLessThanOrEqual(3 + 3 + 2 + 5);
    expect(new Set(watches).size).toBe(watches.length);
  });

  it("keeps each song's requests low enough for Google to tolerate, across the whole golden set", async () => {
    const counts: number[] = [];
    for (const g of golden) {
      const log: string[] = [];
      await findYoutube(savedPages(g.id, log), g.title, g.artist);
      counts.push(log.length);
    }
    expect(Math.max(...counts)).toBeLessThanOrEqual(MAX_REQUESTS_PER_SONG);
    expect(counts.reduce((a, b) => a + b, 0) / counts.length).toBeLessThanOrEqual(AVERAGE_REQUESTS_PER_SONG);
  });

  it("gives nothing without a title or an artist, and asks for nothing", async () => {
    const log: string[] = [];
    const pages = savedPages("sza-sos-t1", log);
    expect(await findYoutube(pages, "", "SZA")).toEqual({ url: "", isMusicVideo: false });
    expect(await findYoutube(pages, "SOS", "")).toEqual({ url: "", isMusicVideo: false });
    expect(log).toEqual([]);
  });

  it("gives nothing when YouTube has nothing, or when the pages cannot be read", async () => {
    const empty: YoutubePages = { search: () => Promise.resolve(null), watch: () => Promise.resolve(null) };
    expect(await findYoutube(empty, "SOS", "SZA")).toEqual({ url: "", isMusicVideo: false });
    const broken: YoutubePages = {
      search: () => Promise.reject(new Error("offline")),
      watch: () => Promise.reject(new Error("offline")),
    };
    expect(await findYoutube(broken, "SOS", "SZA")).toEqual({ url: "", isMusicVideo: false });
  });
});

describe("title matching", () => {
  it.each([
    "Not Like Us",
    "Kendrick Lamar - Not Like Us",
    "Not Like Us (Official Audio)",
    "Not Like Us - Kendrick Lamar",
  ])("accepts %s", (title) => {
    expect(titleMatchesSong(title, "Not Like Us", "Kendrick Lamar")).toBe(true);
  });

  it.each([
    ["Taylor Swift - Fortnight", "Fortnight (feat. Post Malone)", "Taylor Swift"],
    ["Luis Fonsi - Despacito ft. Daddy Yankee", "Despacito (feat. Daddy Yankee)", "Luis Fonsi"],
    ["BAD BUNNY x JHAY CORTEZ - DÁKITI", "DÁKITI", "Bad Bunny & Jhay Cortez"],
    ["Frank Ocean - Pink + White", "Pink + White", "Frank Ocean"],
  ])("accepts the feat. and accent variant %s", (video, song, artist) => {
    expect(titleMatchesSong(video, song, artist)).toBe(true);
  });

  it.each([
    ["Euphoria", "Not Like Us", "Kendrick Lamar"],
    ["SZA - SOS Where The Hell Have You Been ?", "SOS", "SZA"],
    ["Pink Matter", "Pink + White", "SZA"],
  ])("rejects %s for %s", (video, song, artist) => {
    expect(titleMatchesSong(video, song, artist)).toBe(false);
  });

  it("sees a short title with special characters", () => {
    expect(sigPresent("Travis Scott - FE!N ft. Playboi Carti", "FE!N")).toBe(true);
    expect(sigPresent("Travis Scott - Goosebumps", "FE!N")).toBe(false);
  });

  it("does not split an accented word the way an ASCII-only split would", () => {
    expect(sigPresent("BAD BUNNY - DÁKITI (Official Video)", "DÁKITI")).toBe(true);
  });

  it("matches whole words, not pieces of words: 'the' is not in 'feather'", () => {
    const video = "Billie Eilish - BIRDS OF A FEATHER (Official Music Video)";
    expect(sigPresent(video, "THE GREATEST")).toBe(false);
    expect(sigPresent(video, "BIRDS OF A FEATHER")).toBe(true);
    expect(scoreMv(video, "BillieEilishVEVO", "Billie Eilish", "THE GREATEST")).toBe(-1);
    expect(scoreAudio(video, "Billie Eilish - Topic", "Billie Eilish", "THE GREATEST")).toBe(-1);
  });

  it("still finds a song whose title is a word inside a longer video title", () => {
    expect(sigPresent("Taylor Swift - Fortnight (feat. Post Malone) (Official Video)", "Fortnight")).toBe(true);
    expect(sigPresent("Pink + White", "Pink + White")).toBe(true);
  });
});

describe("channels", () => {
  it.each([
    ["Billie Eilish", "Billie Eilish", true],
    ["BillieEilishVEVO", "Billie Eilish", true],
    ["SZAVEVO", "SZA", true],
    ["Taylor Swift", "Taylor Swift & Post Malone", true],
    ["YouTube VeVo", "SZA", false],
    ["Random Reuploads", "SZA", false],
    ["SZA - Topic", "SZA", true],
  ])("%s is the channel of %s: %s", (channel, artist, expected) => {
    expect(isArtistChannel(channel, artist)).toBe(expected);
  });

  it("finds a whole-word artist name in text, or one collaborator", () => {
    expect(namesArtist("Provided to YouTube by RCA · Song · SZA", "SZA")).toBe(true);
    expect(namesArtist("Drake - Song", "Drake & Central Cee")).toBe(true);
    expect(namesArtist("Szakal - Song", "SZA")).toBe(false);
    expect(namesArtist("anything", "")).toBe(false);
  });
});

describe("scoring", () => {
  it("scores an artist's own audio 2 and the auto-generated Topic upload 1, which Genius ranks last", () => {
    expect(scoreAudio("SZA - SOS (Audio)", "SZA", "SZA", "SOS")).toBe(2);
    expect(scoreAudio("SZA - SOS (Official Audio)", "SZA", "SZA", "SOS")).toBe(2);
    expect(scoreAudio("SOS", "SZA - Topic", "SZA", "SOS")).toBe(1);
  });

  it("scores a lyric video on the artist's own channel 3, above any audio", () => {
    expect(scoreLyric("SZA - SOS (Lyric Video)", "SZA", "SZA", "SOS")).toBe(3);
    expect(scoreLyric("SZA - SOS (Official Lyric Video)", "SZAVEVO", "SZA", "SOS")).toBe(3);
    expect(scoreLyric("SZA - SOS (Lyrics)", "SZA", "SZA", "SOS")).toBe(3);
    expect(scoreLyric("SOS (Lyric Video)", "Blonded", "SZA", "SOS", true)).toBe(-1);
    expect(scoreLyric("SZA - SOS (Lyric Video)", "Blonded", "SZA", "SOS", true)).toBe(3);
  });

  it("does not take a lyric video from another channel, a different song, a remix or a live version", () => {
    expect(scoreLyric("SZA - SOS (Lyrics)", "Lyrics Daily", "SZA", "SOS")).toBe(-1);
    expect(scoreLyric("SZA - SOS (Lyric Video)", "Blonded", "SZA", "SOS")).toBe(-1);
    expect(scoreLyric("SZA - Kill Bill (Lyric Video)", "SZA", "SZA", "SOS")).toBe(-1);
    expect(scoreLyric("SZA - SOS (Lyrics) [Remix]", "SZA", "SZA", "SOS")).toBe(-1);
    expect(scoreLyric("SZA - SOS (Live) (Lyrics)", "SZA", "SZA", "SOS")).toBe(-1);
    expect(scoreLyric("SZA - SOS (Official Audio)", "SZA", "SZA", "SOS")).toBe(-1);
    expect(scoreLyric("SZA - SOS (Official Video)", "SZA", "SZA", "SOS")).toBe(-1);
  });

  it("skips what phase 1 must not take: music videos, lyric videos, other songs, other channels", () => {
    expect(scoreAudio("SZA - SOS (Official Video)", "SZA", "SZA", "SOS")).toBe(-1);
    expect(scoreAudio("SZA - SOS (Lyrics)", "SZA", "SZA", "SOS")).toBe(-1);
    expect(scoreAudio("SZA - Kill Bill", "SZA", "SZA", "SOS")).toBe(-1);
    expect(scoreAudio("SZA - SOS", "Random Uploads", "SZA", "SOS")).toBe(-1);
    expect(scoreAudio("SZA - SOS Where The Hell Have You Been ?", "SZA", "SZA", "SOS")).toBe(-1);
  });

  it("accepts the Official Artist Channel badge when the title names the artist", () => {
    expect(scoreAudio("Frank Ocean - Pink + White", "Blonded", "Frank Ocean", "Pink + White", true)).toBe(2);
    expect(scoreAudio("Pink + White", "Blonded", "Frank Ocean", "Pink + White", true)).toBe(-1);
  });

  it("counts a 'Provided to YouTube by' snippet only on a trusted channel", () => {
    const snippet = "Provided to YouTube by RCA Records · SOS · SZA";
    expect(scoreAudio("SOS", "SZA", "SZA", "SOS", false, snippet)).toBe(1);
    expect(scoreAudio("SOS", "Reuploader", "SZA", "SOS", false, snippet)).toBe(-1);
  });

  it("scores a music video 3, a label channel 2 and a plain artist-channel title 1 in phase 2", () => {
    expect(scoreMv("SZA - SOS (Official Music Video)", "SZA", "SZA", "SOS")).toBe(3);
    expect(scoreMv("SZA - SOS", "SZAVEVO", "SZA", "SOS")).toBe(3);
    expect(scoreMv("SZA - SOS", "SZA", "SZA", "SOS")).toBe(1);
    expect(scoreMv("SZA - SOS Official MV", "Label", "SZA", "SOS", true)).toBe(2);
    expect(scoreMv("SZA - SOS Official MV", "Label", "SZA", "SOS", false)).toBe(-1);
    expect(scoreMv("SZA - SOS (Live)", "SZA", "SZA", "SOS")).toBe(-1);
    expect(scoreMv("SZA - SOS (Official Audio)", "SZA", "SZA", "SOS")).toBe(1);
  });

  it("weighs crew credits above generic music-video words in a description", () => {
    expect(descriptionBonus("directed by someone")).toBe(2);
    expect(descriptionBonus("watch the video now")).toBe(1);
    expect(descriptionBonus("just a song")).toBe(0);
  });
});

describe("reading YouTube's pages", () => {
  it("lists the videos of a results page in order, with badges and the snippet", () => {
    const data = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      { adSlotRenderer: {} },
                      {
                        videoRenderer: {
                          videoId: "abcDEF_-123",
                          title: { runs: [{ text: "SZA - SOS" }] },
                          ownerText: { runs: [{ text: "SZA" }] },
                          ownerBadges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_VERIFIED_ARTIST" } }],
                          detailedMetadataSnippets: [
                            { snippetText: { runs: [{ text: "Provided " }, { text: "to YouTube" }] } },
                          ],
                        },
                      },
                      { videoRenderer: { videoId: "" } },
                      { videoRenderer: { videoId: "defGHI_-456" } },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };
    expect(listVideos(data)).toEqual([
      {
        id: "abcDEF_-123",
        title: "SZA - SOS",
        channel: "SZA",
        officialArtist: true,
        verified: false,
        snippet: "Provided to YouTube",
      },
      { id: "defGHI_-456", title: "", channel: "", officialArtist: false, verified: false, snippet: "" },
    ]);
  });

  it.each([
    "abc",
    "abcDEF_-1234",
    'abc"onload="x',
    "../../etc/pas",
    "abc def_-123",
    "<script>alert",
    "abcDEF_-12=",
    12345678901,
  ])("skips a video whose id is not a YouTube id: %j", (id) => {
    const data = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [{ itemSectionRenderer: { contents: [{ videoRenderer: { videoId: id } }] } }],
            },
          },
        },
      },
    };
    expect(listVideos(data)).toEqual([]);
  });

  it.each([null, undefined, 5, "x", [], {}, { contents: 3 }, { contents: { twoColumnSearchResultsRenderer: {} } }])(
    "lists nothing for the malformed page %j",
    (data) => {
      expect(listVideos(data)).toEqual([]);
    },
  );

  it("takes the JSON object out of the page's script, whatever braces and quotes it holds", () => {
    const html = '<script>var ytInitialData = {"a":{"b":"}{\\"x"},"c":[1,2]};</script><script>other()</script>';
    expect(extractVar(html, "ytInitialData")).toEqual({ a: { b: '}{"x' }, c: [1, 2] });
  });

  it.each([
    "",
    "no data here",
    "var ytInitialData = [1];",
    'var ytInitialData = {"a":',
    "var ytInitialData = {bad json};",
  ])("gives null when the page has no usable data: %j", (html) => {
    expect(extractVar(html, "ytInitialData")).toBeNull();
  });

  it("reads a video's description, or nothing", () => {
    expect(descriptionOf({ videoDetails: { shortDescription: "Directed by X" } })).toBe("Directed by X");
    expect(descriptionOf({ videoDetails: {} })).toBe("");
    expect(descriptionOf(null)).toBe("");
  });
});

describe("the cheaper lookup for a metered service (one query for the video, one for the audio)", () => {
  it.each(golden.map((g) => [g.id, g] as const))(
    "%s still gets an accepted video, with at most three searches",
    async (_id, g) => {
      const log: string[] = [];
      const link = await findYoutube(savedPages(g.id, log), g.title, g.artist, { queriesPerPhase: 1 });
      const id = link.url.split("=").pop() ?? "";
      expect(g.accept, link.url).toContain(id);
      expect(link.isMusicVideo).toBe(g.is_music_video);
      expect(log.filter((l) => l.startsWith("search:")).length).toBeLessThanOrEqual(3);
    },
  );

  it("needs more than two searches for only a few songs, so a day's allowance covers about fifty", async () => {
    let over = 0;
    for (const g of golden) {
      const log: string[] = [];
      await findYoutube(savedPages(g.id, log), g.title, g.artist, { queriesPerPhase: 1 });
      if (log.filter((l) => l.startsWith("search:")).length > 2) over++;
    }
    expect(over).toBeLessThanOrEqual(3);
  });

  it("asks for a description only for the few candidates that need confirming", async () => {
    let watches = 0;
    for (const g of golden) {
      const log: string[] = [];
      await findYoutube(savedPages(g.id, log), g.title, g.artist, { queriesPerPhase: 1 });
      watches = Math.max(watches, log.filter((l) => l.startsWith("watch:")).length);
    }
    expect(watches).toBeLessThanOrEqual(7);
  });

  it("is never more expensive than the full lookup", async () => {
    for (const g of golden) {
      const cheap: string[] = [];
      const full: string[] = [];
      await findYoutube(savedPages(g.id, cheap), g.title, g.artist, { queriesPerPhase: 1 });
      await findYoutube(savedPages(g.id, full), g.title, g.artist);
      const searches = (log: string[]) => log.filter((l) => l.startsWith("search:")).length;
      expect(searches(cheap), g.id).toBeLessThanOrEqual(searches(full));
    }
  });
});

/** A results page the way YouTube's own data shapes it, with the videos given. */
function resultsOf(videos: { id: string; title: string; channel: string; badge?: boolean }[]): unknown {
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: videos.map((v) => ({
                    videoRenderer: {
                      videoId: v.id,
                      title: { runs: [{ text: v.title }] },
                      ownerText: { runs: [{ text: v.channel }] },
                      ownerBadges: v.badge
                        ? [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_VERIFIED_ARTIST" } }]
                        : [],
                    },
                  })),
                },
              },
            ],
          },
        },
      },
    },
  };
}

const MV_VIDEO = { id: "mvvideo0001", title: "SZA - SOS (Official Music Video)", channel: "SZA" };
const LYRIC_VIDEO = { id: "lyricvid001", title: "SZA - SOS (Official Lyric Video)", channel: "SZA" };
const OFFICIAL_AUDIO = { id: "offaudio001", title: "SZA - SOS (Official Audio)", channel: "SZA" };
const TOPIC_UPLOAD = { id: "topicupl001", title: "SOS", channel: "SZA - Topic" };

/** Every search answers with the same results, and no watch page has a description. */
const pagesWith = (videos: Parameters<typeof resultsOf>[0]): YoutubePages => ({
  search: () => Promise.resolve(resultsOf(videos)),
  watch: () => Promise.resolve(null),
});

describe("which video wins, by Genius's order: music video, lyric video, official audio, auto-generated", () => {
  const pick = async (videos: Parameters<typeof resultsOf>[0]) => {
    const link = await findYoutube(pagesWith(videos), "SOS", "SZA");
    return { id: link.url.split("=").pop(), mv: link.isMusicVideo };
  };

  it("takes the music video over everything else", async () => {
    expect(await pick([TOPIC_UPLOAD, OFFICIAL_AUDIO, LYRIC_VIDEO, MV_VIDEO])).toEqual({ id: MV_VIDEO.id, mv: true });
  });

  it("takes the lyric video over the official audio and the Topic upload", async () => {
    expect(await pick([TOPIC_UPLOAD, OFFICIAL_AUDIO, LYRIC_VIDEO])).toEqual({ id: LYRIC_VIDEO.id, mv: false });
  });

  it("takes the official audio over the Topic upload, even when the Topic upload is listed first", async () => {
    expect(await pick([TOPIC_UPLOAD, OFFICIAL_AUDIO])).toEqual({ id: OFFICIAL_AUDIO.id, mv: false });
  });

  it("takes the Topic upload only when nothing better exists", async () => {
    expect(await pick([TOPIC_UPLOAD])).toEqual({ id: TOPIC_UPLOAD.id, mv: false });
  });

  it("still looks past a Topic upload in the first search for something better", async () => {
    const searches: string[] = [];
    const pages: YoutubePages = {
      search: (query) => {
        searches.push(query);
        // The Topic-targeted search sees only the Topic upload; the plain search also sees the official audio.
        return Promise.resolve(resultsOf(query.includes("Topic") ? [TOPIC_UPLOAD] : [TOPIC_UPLOAD, OFFICIAL_AUDIO]));
      },
      watch: () => Promise.resolve(null),
    };
    const link = await findYoutube(pages, "SOS", "SZA");
    expect(link.url).toBe(`https://www.youtube.com/watch?v=${OFFICIAL_AUDIO.id}`);
    expect(searches.length).toBeGreaterThan(audioQueries("SOS", "SZA").slice(0, 1).length);
  });
});
