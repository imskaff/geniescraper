import { describe, expect, it } from "vitest";
import { parseAppleMusicUrl } from "../../src/apple/url";

describe("parseAppleMusicUrl", () => {
  it.each([
    ["https://music.apple.com/us/album/the-tortured-poets-department/1736268215", { kind: "album", storefront: "us" }],
    [
      "https://music.apple.com/us/album/the-tortured-poets-department/1736268215?i=1736268220",
      { kind: "album", storefront: "us" },
    ],
    ["https://music.apple.com/gb/song/fortnight/1736268220", { kind: "song", storefront: "gb" }],
    ["https://music.apple.com/us/album/1736268215", { kind: "album", storefront: "us" }],
    ["https://music.apple.com/pl/song/x/1#frag", { kind: "song", storefront: "pl" }],
  ])("accepts %s", (url, expected) => {
    expect(parseAppleMusicUrl(url)).toEqual(expected);
  });

  it.each([
    "",
    "not a url",
    "http://music.apple.com/us/song/x/1",
    "https://music.apple.com.evil.example/us/song/x/1",
    "https://evil.example/https://music.apple.com/us/song/x/1",
    "https://user@music.apple.com/us/song/x/1",
    "https://music.apple.com/us/playlist/x/pl.1",
    "https://music.apple.com/us/artist/x/1",
    "https://music.apple.com/us/song/x/abc",
    "https://music.apple.com/USA/song/x/1",
    "javascript:alert(1)",
    " https://music.apple.com/us/song/x/1",
  ])("refuses %j", (url) => {
    expect(parseAppleMusicUrl(url)).toBeNull();
  });
});
