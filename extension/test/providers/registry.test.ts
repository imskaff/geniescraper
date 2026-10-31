import { describe, expect, it } from "vitest";
import { APPLE_PROVIDER } from "../../src/providers/apple";
import { SPOTIFY_PROVIDER } from "../../src/providers/spotify";
import { PROVIDERS, recogniseUrl, unsupportedLinkMessage } from "../../src/providers/registry";
import { ALBUM_URL, SONG_URL } from "../background/fakePorts";
import { FAKE_ALBUM, FAKE_PROVIDER, FAKE_SONG } from "./fakeProvider";

const BOTH = [APPLE_PROVIDER, FAKE_PROVIDER];

describe("recogniseUrl", () => {
  it("ships Apple Music as the registered provider", () => {
    expect(PROVIDERS).toEqual([APPLE_PROVIDER, SPOTIFY_PROVIDER]);
    expect(recogniseUrl(SONG_URL)?.provider).toBe(APPLE_PROVIDER);
  });

  it("routes each address to the provider that owns it", () => {
    expect(recogniseUrl(ALBUM_URL, BOTH)).toEqual({
      provider: APPLE_PROVIDER,
      url: { kind: "album", region: "us" },
    });
    expect(recogniseUrl(FAKE_SONG, BOTH)).toEqual({ provider: FAKE_PROVIDER, url: { kind: "song", region: "" } });
    expect(recogniseUrl(FAKE_ALBUM, BOTH)?.url.kind).toBe("album");
  });

  it("recognises nothing the providers do not claim", () => {
    expect(recogniseUrl("https://evil.example/album/x/1", BOTH)).toBeNull();
    expect(recogniseUrl(FAKE_SONG)).toBeNull();
  });
});

describe("unsupportedLinkMessage", () => {
  it("keeps the provider's own wording when it is the only one", () => {
    expect(unsupportedLinkMessage("album-or-song", [APPLE_PROVIDER])).toBe("Not an Apple Music album or song link.");
    expect(unsupportedLinkMessage("song", [APPLE_PROVIDER])).toBe("Not an Apple Music song link.");
  });

  it("is general once several providers exist", () => {
    expect(unsupportedLinkMessage("album-or-song", BOTH)).toBe("Not a supported album or song link.");
  });
});

describe("role mapping", () => {
  it("keeps each provider's table to itself", () => {
    expect(FAKE_PROVIDER.normaliseRole("Words By")).toBe("Writer");
    expect(APPLE_PROVIDER.normaliseRole("Words By")).not.toBe("Writer");
    expect(APPLE_PROVIDER.normaliseRole("Songwriter")).toBe("Songwriter");
    expect(FAKE_PROVIDER.normaliseRole("Songwriter")).toBe("Songwriter");
  });
});
