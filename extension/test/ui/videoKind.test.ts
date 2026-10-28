import { afterEach, describe, expect, it } from "vitest";
import type { VideoKind } from "../../src/core/models";
import { PanelController } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import { ALBUM, fakeEnv } from "./fakes";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const LINK = "https://www.youtube.com/watch?v=abcDEF_-123";

async function openTrack(kind: VideoKind | undefined, isMusicVideo = kind === "music-video") {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const env = fakeEnv({
    hosts: { youtube: true },
    api: {
      lookupYoutube: () =>
        Promise.resolve({
          ok: true,
          data: { url: LINK, isMusicVideo, ...(kind ? { kind } : {}), throttled: false, keyProblem: "" as const },
        }),
    },
  });
  const panel = await PanelController.create(env);
  new PanelView(root, panel);
  await panel.detect(ALBUM.url);
  await panel.setAllSelected(true);
  await panel.getCredits();
  await flush();
  await panel.showTrack(0);
  await flush();
  return { root, panel };
}

const labels = (root: HTMLElement): string[] => [...root.querySelectorAll("dt")].map((dt) => dt.textContent);

afterEach(() => {
  document.body.replaceChildren();
});

describe("which kind of video the panel says it found", () => {
  it.each([
    ["music-video", "YouTube (music video)"],
    ["lyric-video", "YouTube (lyric video)"],
    ["official-audio", "YouTube (official audio)"],
    ["auto-generated", "YouTube (auto-generated)"],
  ] as const)("says %s in the credits of the track", async (kind, label) => {
    const { root, panel } = await openTrack(kind);
    expect(panel.state.session.results[0]?.song?.youtubeKind).toBe(kind);
    expect(labels(root)).toContain(label);
  });

  it("falls back to music video or audio for a link saved before the kind was known", async () => {
    expect(labels((await openTrack(undefined, true)).root)).toContain("YouTube (music video)");
    expect(labels((await openTrack(undefined, false)).root)).toContain("YouTube (audio)");
  });

  it("says it is the user's own link, whatever was found before", async () => {
    const { root, panel } = await openTrack("lyric-video");
    await panel.setYoutubeLink(0, "https://www.youtube.com/watch?v=zyxWVU_-987");
    await flush();
    expect(panel.state.session.results[0]?.song?.youtubeKind).toBeUndefined();
    expect(labels(root)).toContain("YouTube (your link)");
  });
});
