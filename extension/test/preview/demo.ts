// Plays the real side panel through the whole story with the tests' sample data (Demo Artist, Demo Album), one scene
// at a time, for the release animation. Bundled and driven by scripts/release-demo.mjs; it is not part of the
// extension or of the test run.
import { PanelController } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import { ALBUM, fakeEnv } from "../ui/fakes";

const found = {
  ok: true as const,
  data: {
    url: "https://www.youtube.com/watch?v=abcDEF_-123",
    isMusicVideo: true,
    throttled: false,
    keyProblem: "" as const,
  },
};

const CAPTIONS: Record<string, [string, string]> = {
  listening: ["It listens for Apple Music", "Open an album or song in your browser and the panel notices."],
  found: ["It finds the page for you", "No copying links: the page you are on comes first."],
  reading: ["One press reads the album", "Songwriters, producers, other roles and copyright lines."],
  tracks: ["Pick the tracks you need", "Tracks Apple Music has no page for are left out."],
  credits: ["Every track is checked", "Anything missing is marked, so nothing is a surprise."],
  paste: ["Auto-paste fills the Genius form", "It pauses when you touch the form, and never presses Save."],
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const flush = (): Promise<void> => sleep(60);

async function setup() {
  const env = fakeEnv({
    hosts: { youtube: true },
    settings: { onboarded: true, pasteMode: "auto" },
    api: {
      // A short wait, so the dots on the button are seen working.
      detect: async () => {
        await sleep(1500);
        return { ok: true, data: ALBUM };
      },
      lookupYoutube: () => Promise.resolve(found),
    },
  });
  const panel = await PanelController.create(env);
  new PanelView(document.getElementById("app") as HTMLElement, panel);
  return { env, panel };
}

const world = setup();

function caption(scene: string): void {
  const [title, line] = CAPTIONS[scene] ?? ["", ""];
  (document.getElementById("title") as HTMLElement).textContent = title;
  (document.getElementById("line") as HTMLElement).textContent = line;
}

const scenes: Record<string, () => Promise<void>> = {
  async listening() {
    await world;
  },
  async found() {
    const { env, panel } = await world;
    env.openTabs.push({
      tabId: 1,
      url: ALBUM.url,
      title: "Demo Album - Album by Demo Artist - Apple Music",
      current: true,
    });
    await panel.refreshPage();
  },
  async reading() {
    await world;
    // The real button, pressed the way a person would.
    document.querySelector<HTMLButtonElement>('[data-key="open-page-0"]')?.click();
  },
  async tracks() {
    await world;
  },
  async credits() {
    const { panel } = await world;
    await panel.setAllSelected(true);
    await panel.getCredits();
    await flush();
  },
  async paste() {
    const { panel } = await world;
    await panel.startPaste(0);
    await flush();
  },
};

(window as unknown as { scene: (name: string) => Promise<void> }).scene = async (name) => {
  caption(name);
  await scenes[name]?.();
};
