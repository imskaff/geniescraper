import { describe, expect, it } from "vitest";
import { releaseDateText, releaseDay, releaseMonth, releaseYear } from "../../src/core/models";
import {
  dateFromMeta,
  dateFromText,
  formatReleaseDate,
  pickReleaseDate,
  splitReleaseDate,
} from "../../src/core/releaseDate";
import vectors from "../vectors.json";
import { songFromVector } from "./helpers";

describe("dateFromMeta parity with scraper.release_date.date_from_meta", () => {
  it.each(vectors.date_from_meta)("$input", ({ input, output }) => {
    expect(dateFromMeta(input)).toBe(output);
  });
});

describe("dateFromText parity with scraper.release_date.date_from_text", () => {
  it.each(vectors.date_from_text)("$input", ({ input, output }) => {
    expect(dateFromText(input)).toBe(output);
  });
});

describe("pickReleaseDate parity with scraper.release_date.pick_release_date", () => {
  it.each(vectors.pick_release_date)("$meta | $subtitle | $footer", ({ meta, subtitle, footer, output }) => {
    expect(pickReleaseDate(meta, subtitle, footer)).toBe(output);
  });
});

describe("stored dates parity with split_release_date and format_release_date", () => {
  it.each(vectors.release_date_parts)("$input", ({ input, split, text }) => {
    expect(splitReleaseDate(input)).toEqual(split);
    expect(formatReleaseDate(input)).toBe(text);
  });
});

describe("the song's release date helpers", () => {
  it("give the parts and the display text", () => {
    const song = songFromVector("full");
    expect(song.releaseDate).toBe("2024-05-17");
    expect([releaseYear(song), releaseMonth(song), releaseDay(song)]).toEqual([2024, 5, 17]);
    expect(releaseDateText(song)).toBe("May 17, 2024");
  });

  it("are null and empty when the date is unknown", () => {
    const song = songFromVector("empty");
    expect([releaseYear(song), releaseMonth(song), releaseDay(song)]).toEqual([null, null, null]);
    expect(releaseDateText(song)).toBe("");
  });
});

describe("odd inputs never throw", () => {
  it.each(["", " ", "0000-01-01", "0099-12-31", "9999-12-31T00:00:00Z", "\u0000", "May 17, 0000", "x".repeat(10_000)])(
    "%j",
    (text) => {
      expect(() => dateFromMeta(text)).not.toThrow();
      expect(() => dateFromText(text)).not.toThrow();
    },
  );
});
