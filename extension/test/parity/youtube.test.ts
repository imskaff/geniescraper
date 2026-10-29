import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SongName } from "./helpers";
import { songFromVector } from "./helpers";
import { parseYoutubeLink, youtubeSearchUrl } from "../../src/core/youtubeLink";
import { trackHealth } from "../../src/core/trackHealth";
import { listVideos, scoreAudio, scoreLyric, scoreMv } from "../../src/lookups/youtube";
import vectors from "../vectors.json";

const TESTS = join(import.meta.dirname, "..", "..", "..", "tests");

interface Golden {
  id: string;
  title: string;
  artist: string;
}
interface Fixture {
  searches: Record<string, unknown>;
}

const golden = JSON.parse(readFileSync(join(TESTS, "golden", "youtube.json"), "utf-8")) as Golden[];

describe("youtube scoring parity with scraper.youtube, over the saved search pages", () => {
  const scores = vectors.youtube_scores as Record<string, Record<string, number[]>>;

  it("has a row for every golden song", () => {
    expect(Object.keys(scores).sort()).toEqual(golden.map((g) => g.id).sort());
  });

  it.each(golden.map((g) => [g.id, g] as const))(
    "%s: every video scores [lyric, audio, music video] as in Python",
    (_id, g) => {
      const saved = JSON.parse(
        readFileSync(join(TESTS, "fixtures", "lookups", "youtube", `${g.id}.json`), "utf-8"),
      ) as Fixture;
      const got: Record<string, number[]> = {};
      for (const query of Object.keys(saved.searches).sort()) {
        for (const v of listVideos(saved.searches[query]).slice(0, 10)) {
          got[v.id] ??= [
            scoreLyric(v.title, v.channel, g.artist, g.title, v.officialArtist),
            scoreAudio(v.title, v.channel, g.artist, g.title, v.officialArtist, v.snippet),
            scoreMv(v.title, v.channel, g.artist, g.title, v.verified),
          ];
        }
      }
      expect(got).toEqual(scores[g.id]);
    },
  );
});

describe("parseYoutubeLink parity with scraper.youtube_link.parse_youtube_link", () => {
  it.each(vectors.parse_youtube_link.map((c) => [JSON.stringify(c.input), c] as const))(
    "%s",
    (_label, { input, output }) => {
      expect(parseYoutubeLink(input)).toBe(output);
    },
  );
});

describe("youtubeSearchUrl parity with scraper.youtube_link.youtube_search_url", () => {
  it.each(vectors.youtube_search_url.map((c) => [`${c.title} / ${c.artist}`, c] as const))(
    "%s",
    (_label, { title, artist, output }) => {
      expect(youtubeSearchUrl(title, artist)).toBe(output);
    },
  );
});

describe("trackHealth parity with scraper.track_health.track_health", () => {
  it.each(vectors.track_health.map((c, i) => [`${String(i)}: ${c.status} ${c.song ?? "-"}`, c] as const))(
    "%s",
    (_label, c) => {
      const [copyright = true, coverArt = true, youtube = true] = c.wants;
      const health = trackHealth({
        status: c.status as "pending" | "loading" | "done" | "error" | "unavailable",
        song: c.song ? songFromVector(c.song as SongName) : null,
        wants: { copyright, coverArt, youtube },
        youtubeSearching: c.searching,
      });
      expect(health).toEqual(c.output);
    },
  );
});
