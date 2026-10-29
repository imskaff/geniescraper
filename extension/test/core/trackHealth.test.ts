import { describe, expect, it } from "vitest";
import type { SongCredits } from "../../src/core/models";
import { trackHealth, type HealthInput } from "../../src/core/trackHealth";

const SONG: SongCredits = {
  title: "One",
  artist: "A",
  appleMusicUrl: "https://music.apple.com/x",
  credits: [{ role: "Songwriter", artists: ["W"] }],
  phonographicCopyright: "℗ 2024 Records",
  copyrightNotice: "",
  coverArtUrl: "https://example.com/c.png",
  youtubeUrl: "https://www.youtube.com/watch?v=abcDEF_-123",
  youtubeIsMv: true,
  releaseDate: "2024-04-19",
};
const ALL = { copyright: true, coverArt: true, youtube: true };

const health = (patch: Partial<Omit<HealthInput, "song">> & { song?: Partial<SongCredits> | null }) => {
  const { song, ...rest } = patch;
  return trackHealth({
    status: "done",
    song: song === null ? null : { ...SONG, ...song },
    wants: ALL,
    youtubeSearching: false,
    ...rest,
  });
};

describe("a track's health in the credits list", () => {
  it("is ok when everything asked for was found", () => {
    expect(health({})).toEqual({ level: "ok", label: "All found", missing: [] });
  });

  it("needs attention when there are no credits", () => {
    expect(health({ song: { credits: [] } })).toMatchObject({ level: "attention", missing: ["credits"] });
  });

  it("names each thing that is missing", () => {
    const result = health({
      song: { phonographicCopyright: "", coverArtUrl: "", youtubeUrl: "" },
      youtubeSearching: false,
    });
    expect(result.level).toBe("attention");
    expect(result.missing).toEqual(["copyright", "cover art", "YouTube link"]);
    expect(result.label).toBe("Needs a look: copyright, cover art, YouTube link");
  });

  it("takes either copyright line as the copyright", () => {
    expect(health({ song: { phonographicCopyright: "", copyrightNotice: "© 2024" } }).level).toBe("ok");
  });

  it("never says All found while the YouTube link is still being looked for", () => {
    expect(health({ song: { youtubeUrl: "" }, youtubeSearching: true })).toEqual({
      level: "working",
      label: "Finding YouTube link",
      missing: [],
    });
  });

  it("asks for a look once the link was looked for and not found", () => {
    expect(health({ song: { youtubeUrl: "" } })).toMatchObject({
      level: "attention",
      missing: ["YouTube link"],
    });
  });

  it("reports other missing things while the link is still being looked for", () => {
    const result = health({ song: { youtubeUrl: "", coverArtUrl: "" }, youtubeSearching: true });
    expect(result).toMatchObject({ level: "attention", missing: ["cover art"] });
  });

  it("does not count a step the user switched off", () => {
    const result = health({
      song: { phonographicCopyright: "", coverArtUrl: "", youtubeUrl: "" },
      wants: { copyright: false, coverArt: false, youtube: false },
      youtubeSearching: false,
    });
    expect(result.level).toBe("ok");
  });

  it.each([
    ["pending", "waiting", "Waiting"],
    ["loading", "working", "Reading"],
    ["error", "error", "Failed"],
    ["unavailable", "none", "No page"],
  ] as const)("reports a %s track as %s", (status, level, label) => {
    expect(health({ status, song: null })).toEqual({ level, label, missing: [] });
  });

  it("treats a finished track with no song as failed", () => {
    expect(health({ song: null }).level).toBe("error");
  });
});
