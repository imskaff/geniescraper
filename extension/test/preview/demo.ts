// Plays the real side panel through the whole story with the tests' sample data (Demo Artist, Demo Album), one scene
// at a time, for the release animation. Bundled and driven by scripts/release-demo.mjs; it is not part of the
// extension or of the test run. The sample ℗ line names a label the extension knows, because Label and Distributor
// are only derived from known names; everything else is made up.
import { begin, pauseAuto, report } from "../../src/core/paste";
import { PanelController } from "../../src/ui/controller";
import { FIELD_LABELS } from "../../src/ui/fieldLabels";
import { footer } from "../../src/ui/footer";
import { PanelView } from "../../src/ui/view";
import { ALBUM, fakeEnv } from "../ui/fakes";

const APPLE = {
  ...ALBUM,
  phonographicCopyright: "℗ 2024 Island Records, a division of UMG Recordings, Inc.",
  copyrightNotice: "© 2024 Demo Publishing",
};
const SPOTIFY_URL = "https://open.spotify.com/track/DemoTrack0123456789abc";
const SPOTIFY = {
  ...APPLE,
  url: SPOTIFY_URL,
  albumTitle: "Demo Single",
  trackCount: 1,
  trackTitles: ["Demo Single"],
  trackUrls: [SPOTIFY_URL],
};

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
  listening: ["It listens for music pages", "Open an album or song on Apple Music or Spotify and the panel notices."],
  found: ["It finds the pages for you", "Each one is labelled with its source, and the page you are on comes first."],
  reading: ["One press reads the album", "Songwriters, producers, other roles and copyright lines."],
  tracks: ["Pick the tracks you need", "Tracks Apple Music has no page for are left out."],
  credits: ["Every track is checked", "Anything missing is marked, so nothing is a surprise."],
  detail: [
    "Label, distributor and date too",
    "Worked out from the copyright line, with a note on where each came from.",
  ],
  spotify: ["Spotify pages work the same", "Same review, same checks, whichever site the credits come from."],
  genius: ["Open on Genius", "It finds the song on Genius and opens its edit page for you."],
  paste: ["Auto-paste fills the Genius form", "One field at a time, in the order the form has them."],
  pause: ["It pauses when you touch the form", "Turn it back on when you are ready. It never presses Save."],
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const flush = (): Promise<void> => sleep(60);
const press = (key: string): void => document.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)?.click();

async function setup() {
  const env = fakeEnv({
    hosts: { youtube: true },
    settings: { onboarded: true, pasteMode: "auto" },
    api: {
      // A short wait, so the dots on the button are seen working.
      detect: async (url) => {
        await sleep(1300);
        return { ok: true, data: url === SPOTIFY_URL ? SPOTIFY : APPLE };
      },
      lookupYoutube: () => Promise.resolve(found),
      openOnGenius: async () => {
        await sleep(900);
        return {
          ok: true,
          data: {
            status: "opened",
            song: {
              title: "Demo Single",
              artists: ["Demo Artist"],
              url: "https://genius.com/Demo-artist-demo-single-lyrics",
            },
          },
        };
      },
    },
  });
  const panel = await PanelController.create(env);
  const app = document.getElementById("app") as HTMLElement;
  new PanelView(app, panel);
  app.after(footer());
  return { env, panel };
}

const world = setup();
const w = window as unknown as { ready: boolean; scene: (name: string) => Promise<void> };
w.ready = false;
void world.then(() => {
  w.ready = true;
});

/** Scrolls the panel to its top, or to its bottom (where the list of open pages is). */
function scrollPanel(where: "top" | "bottom"): void {
  const app = document.getElementById("app") as HTMLElement;
  app.scrollTop = where === "top" ? 0 : app.scrollHeight;
}

function caption(scene: string): void {
  const [title, line] = CAPTIONS[scene] ?? ["", ""];
  (document.getElementById("title") as HTMLElement).textContent = title;
  (document.getElementById("line") as HTMLElement).textContent = line;
  (document.getElementById("form") as HTMLElement).hidden = scene !== "paste" && scene !== "pause";
}

/** A stand-in for the Genius edit form, filled from the paste queue as the panel's steps are done. */
function drawForm(queue: readonly (readonly [string, string])[], position: number): void {
  const rows = document.getElementById("rows") as HTMLElement;
  const first = Math.max(0, Math.min(position - 3, queue.length - 8));
  rows.replaceChildren(
    ...queue.slice(first, first + 8).map(([kind, value], offset) => {
      const row = document.createElement("div");
      row.className = first + offset === position ? "row now" : "row";
      const name = document.createElement("span");
      name.textContent = FIELD_LABELS[kind as keyof typeof FIELD_LABELS];
      const text = document.createElement("span");
      text.textContent = first + offset < position ? value : "";
      row.append(name, text);
      return row;
    }),
  );
}

/** Scrolls the panel so the credits row with this name is in view. */
function reveal(name: string): void {
  const term = [...document.querySelectorAll<HTMLElement>(".credits dt")].find((dt) => dt.textContent === name);
  term?.scrollIntoView({ block: "center" });
}

const scenes: Record<string, () => Promise<void>> = {
  async listening() {
    await world;
  },
  async found() {
    const { env, panel } = await world;
    env.openTabs.push(
      { tabId: 1, url: APPLE.url, title: "Demo Album - Album by Demo Artist - Apple Music", current: true },
      {
        tabId: 2,
        url: SPOTIFY_URL,
        title: "Spotify",
        pageTitle: "Demo Single",
        pageArtist: "Demo Artist",
        pageSingle: true,
        current: false,
      },
    );
    await panel.refreshPage();
    await flush();
    scrollPanel("bottom");
  },
  async reading() {
    await world;
    // The real button, pressed the way a person would.
    press("open-page-0");
    await flush();
    scrollPanel("top");
  },
  async tracks() {
    const { panel } = await world;
    await sleep(900);
    await panel.setAllSelected(true);
  },
  async credits() {
    const { panel } = await world;
    await panel.getCredits();
    await flush();
  },
  async detail() {
    const { panel } = await world;
    await panel.showTrack(0);
    await flush();
    reveal("Label");
  },
  async spotify() {
    const { panel } = await world;
    await panel.newAlbum();
    await flush();
    scrollPanel("bottom");
    await sleep(1300);
    press("open-page-1");
    scrollPanel("top");
    await sleep(2000);
    await panel.setAllSelected(true);
    await panel.getCredits();
    await panel.showTrack(0);
    await flush();
    reveal("Label");
  },
  async genius() {
    await world;
    scrollPanel("top");
    press("genius-open");
    await sleep(1300);
    document.querySelector('[data-key="genius-notice"]')?.scrollIntoView({ block: "center" });
  },
  async paste() {
    const { env, panel } = await world;
    await panel.startPaste(0);
    scrollPanel("top");
    await panel.autoPaste();
    const paused = Math.ceil(env.api.pasteState.queue.length * 0.5);
    // The worker's loop, played by hand: each step is begun and reported filled.
    while (env.api.pasteState.position < paused) {
      const queue = env.api.pasteState.queue;
      drawForm(queue, env.api.pasteState.position);
      await sleep(650);
      const started = begin(env.api.pasteState, Date.now(), "auto");
      if (started.result.action !== "fill") break;
      env.api.pasteState = report(started.state, started.result.position, { status: "filled", message: "Filled." });
      panel.setPaste(env.api.pasteState);
    }
    drawForm(env.api.pasteState.queue, env.api.pasteState.position);
  },
  async pause() {
    const { env, panel } = await world;
    env.api.pasteState = pauseAuto(env.api.pasteState, "input");
    panel.setPaste(env.api.pasteState);
    await flush();
    scrollPanel("top");
  },
};

w.scene = async (name) => {
  caption(name);
  await scenes[name]?.();
};
