import { describe, expect, it } from "vitest";
import { parseYoutubeLink, youtubeSearchUrl } from "../../src/core/youtubeLink";

const ID = "BY_XwvKogC8";
const WATCH = `https://www.youtube.com/watch?v=${ID}`;

describe("parseYoutubeLink", () => {
  it.each([
    [WATCH, WATCH],
    [`  ${WATCH}  `, WATCH],
    [`http://www.youtube.com/watch?v=${ID}`, WATCH],
    [`https://youtube.com/watch?v=${ID}&t=42s&list=PL123`, WATCH],
    [`https://m.youtube.com/watch?v=${ID}`, WATCH],
    [`https://music.youtube.com/watch?v=${ID}&si=abc`, WATCH],
    [`https://youtu.be/${ID}`, WATCH],
    [`https://youtu.be/${ID}?si=xyz&t=3`, WATCH],
    [`youtu.be/${ID}`, WATCH],
    [`www.youtube.com/watch?v=${ID}`, WATCH],
    [`https://www.youtube.com/shorts/${ID}`, WATCH],
    [`https://www.youtube.com/embed/${ID}`, WATCH],
    [`https://www.youtube.com/live/${ID}?feature=share`, WATCH],
  ])("turns %s into the watch link", (raw, expected) => {
    expect(parseYoutubeLink(raw)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "hello",
    "https://example.com/watch?v=BY_XwvKogC8",
    "https://www.youtube.com.evil.example/watch?v=BY_XwvKogC8",
    "https://evil.example/https://www.youtube.com/watch?v=BY_XwvKogC8",
    "https://user:pass@www.youtube.com/watch?v=BY_XwvKogC8",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=BY_XwvKogC8extra",
    "https://www.youtube.com/watch?v=BY_XwvKogC!",
    "https://www.youtube.com/playlist?list=PLabcdefghijk",
    "https://www.youtube.com/results?search_query=billie",
    "https://www.youtube.com/@BillieEilish",
    "https://youtu.be/",
    "javascript:alert(1)",
    "ftp://www.youtube.com/watch?v=BY_XwvKogC8",
    '<script>alert("x")</script>',
    `https://www.youtube.com/watch?v=${ID}${"a".repeat(400)}`,
  ])("rejects %j", (raw) => {
    expect(parseYoutubeLink(raw)).toBeNull();
  });
});

describe("youtubeSearchUrl", () => {
  it("is a YouTube results page for the artist, the title and 'official music video', safely encoded", () => {
    const url = new URL(youtubeSearchUrl("Don't Smile & Go", "Billie  Eilish"));
    expect(url.origin + url.pathname).toBe("https://www.youtube.com/results");
    expect(url.searchParams.get("search_query")).toBe("Billie Eilish Don't Smile & Go official music video");
  });

  it("stays on youtube.com whatever the title holds", () => {
    const url = new URL(youtubeSearchUrl("//evil.example/?x=1#", "a/b"));
    expect(url.hostname).toBe("www.youtube.com");
    expect(url.hash).toBe("");
  });
});
