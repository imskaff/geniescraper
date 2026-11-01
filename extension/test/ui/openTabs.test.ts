import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenTab } from "../../src/core/musicTabs";
import { PanelController } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import { ALBUM, SINGLE, fakeEnv } from "./fakes";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const $ = (root: ParentNode, selector: string): HTMLElement => {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};

const SONG_URL = "https://music.apple.com/us/song/chihiro/1739659140";
const tabs = (...list: [url: string, title: string, current?: boolean][]): OpenTab[] =>
  list.map(([url, title, current], index) => ({ tabId: index + 1, url, title, current: current ?? false }));

async function mount(options: Parameters<typeof fakeEnv>[0] = {}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const env = fakeEnv(options);
  const panel = await PanelController.create(env);
  new PanelView(root, panel);
  await flush();
  return { root, env, panel };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("the open Apple Music pages on the link screen", () => {
  it("lists each open album or song, the page the user is on first and marked, with what each is", async () => {
    const { root } = await mount({
      openTabs: tabs(
        [ALBUM.url, "‎Demo Album - Album by Demo Artist - Apple Music"],
        [SONG_URL, "Chihiro - Song by Demo Artist - Apple Music", true],
      ),
    });
    const section = $(root, '[data-key="open-pages"]');
    expect(section.getAttribute("data-state")).toBe("found");
    expect(section.querySelector("h3")?.textContent).toBe("2 music pages detected");
    const items = [...section.querySelectorAll<HTMLElement>("li")];
    expect(items.map((li) => li.querySelector(".open-name")?.textContent)).toEqual([
      "Demo Artist - Chihiro",
      "Demo Artist - Demo Album",
    ]);
    expect(items.map((li) => li.querySelector(".tag")?.textContent)).toEqual([
      "Apple Music · Song · this page",
      "Apple Music · Album",
    ]);
  });

  it("says it is listening when no Apple Music page is open, and tells what to do", async () => {
    const { root } = await mount({ openTabs: [] });
    const section = $(root, '[data-key="open-pages"]');
    expect(section.getAttribute("data-state")).toBe("listening");
    expect(section.querySelector("h3")?.textContent).toBe("Listening for Apple Music or Spotify pages…");
    expect(section.textContent).toContain("Open an album or song");
    expect(section.querySelector("li")).toBeNull();
    // The link box and the Scrape button are as they were.
    expect(root.querySelector("#link")).not.toBeNull();
  });

  it("leaves out pages that are not an album or a song", async () => {
    const { root } = await mount({
      openTabs: tabs(["https://music.apple.com/us/browse", "Browse - Apple Music"], [ALBUM.url, "Demo Album"]),
    });
    expect(root.querySelectorAll('[data-key="open-pages"] li')).toHaveLength(1);
    expect($(root, '[data-key="open-pages"] h3').textContent).toBe("Music page detected");
  });

  it("makes the page the user is on stand out from the others", async () => {
    const { root } = await mount({
      openTabs: tabs([ALBUM.url, "Demo Album - Apple Music"], [SONG_URL, "Chihiro - Apple Music", true]),
    });
    expect($(root, '[data-key="open-page-0"]').getAttribute("data-current")).toBe("true");
    expect($(root, '[data-key="open-page-1"]').hasAttribute("data-current")).toBe(false);
  });

  it("announces a detection politely, in a region that is there before anything is found", async () => {
    const { root } = await mount({ openTabs: [] });
    expect($(root, '[data-key="open-pages"] [aria-live="polite"]')).not.toBeNull();
  });

  it("gets the tracks of a page with one click, and goes on to the track list", async () => {
    const { root, env, panel } = await mount({ openTabs: tabs([ALBUM.url, "Demo Album - Apple Music"]) });
    $(root, '[data-key="open-page-0"]').click();
    await flush();
    expect(env.api.calls).toContain(`detect:${ALBUM.url}:undefined`);
    expect(panel.state.session.screen).toBe("tracks");
    expect($(root, "h2").textContent).toBe(ALBUM.albumTitle);
  });

  it("reads the page the user is on in place, as the link box always did, and the others in a hidden window", async () => {
    const current = await mount({
      tab: { tabId: 9, url: SONG_URL },
      openTabs: tabs([SONG_URL, "Chihiro - Apple Music", true]),
      api: { detect: () => Promise.resolve({ ok: true, data: SINGLE }) },
    });
    $(current.root, '[data-key="open-page-0"]').click();
    await flush();
    expect(current.env.api.calls).toContain(`detect:${SONG_URL}:9`);

    const other = await mount({
      tab: { tabId: 9, url: "https://example.com/" },
      openTabs: tabs([ALBUM.url, "Demo Album - Apple Music"]),
    });
    $(other.root, '[data-key="open-page-0"]').click();
    await flush();
    expect(other.env.api.calls).toContain(`detect:${ALBUM.url}:undefined`);
  });

  it("names every item for a screen reader by what pressing it does, and says which page the user is on", async () => {
    const { root } = await mount({
      openTabs: tabs([ALBUM.url, "Demo Album - Apple Music"], [SONG_URL, "Chihiro - Apple Music", true]),
    });
    expect($(root, '[data-key="open-page-0"]').getAttribute("aria-label")).toBe(
      "Get tracks for Chihiro, the page you are on",
    );
    expect($(root, '[data-key="open-page-1"]').getAttribute("aria-label")).toBe("Get tracks for Demo Album");
  });

  it("shows a tab's title as text, never as markup", async () => {
    const hostile = '<img src=x onerror="window.__pwned=1"> - Apple Music';
    const { root } = await mount({ openTabs: tabs([ALBUM.url, hostile]) });
    expect(root.querySelector("img")).toBeNull();
    expect($(root, ".open-name").textContent).toContain("<img");
    expect((window as unknown as Record<string, unknown>)["__pwned"]).toBeUndefined();
  });

  it("follows the browser: a page opened or closed later changes the list when the panel refreshes", async () => {
    const { root, env, panel } = await mount({ openTabs: [] });
    expect($(root, '[data-key="open-pages"]').getAttribute("data-state")).toBe("listening");
    env.openTabs.push(...tabs([ALBUM.url, "Demo Album - Apple Music"]));
    await panel.refreshPage();
    await flush();
    expect(root.querySelectorAll('[data-key="open-pages"] li')).toHaveLength(1);
    env.openTabs.length = 0;
    await panel.refreshPage();
    await flush();
    expect($(root, '[data-key="open-pages"]').getAttribute("data-state")).toBe("listening");
  });

  it("copes with the browser refusing to list its tabs", async () => {
    const { root, env, panel } = await mount();
    env.appleTabs = () => Promise.reject(new Error("no access"));
    await expect(panel.refreshPage()).resolves.toBeUndefined();
    await flush();
    expect($(root, '[data-key="open-pages"]').getAttribute("data-state")).toBe("listening");
  });

  it("cannot be pressed while a page is being read", async () => {
    const { root, panel } = await mount({ openTabs: tabs([ALBUM.url, "Demo Album"]) });
    void panel.detect(ALBUM.url);
    await flush();
    const maybe = root.querySelector<HTMLButtonElement>('[data-key="open-page-0"]');
    // Either the list is gone with the screen, or its buttons are off while the read runs.
    expect(maybe === null || maybe.disabled).toBe(true);
  });

  it("is not on the other screens", async () => {
    const { root, panel } = await mount({ openTabs: tabs([ALBUM.url, "Demo Album"]) });
    await panel.detect(ALBUM.url);
    await flush();
    expect(root.querySelector('[data-key="open-pages"]')).toBeNull();
  });
});

describe("the link screen layout", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "..", "src", "ui", "panel.css"), "utf-8");

  it("puts Get credits right under the help text, and keeps the room for the longest help text below it", () => {
    // The help text takes the room its words need, so the button sits directly under it ...
    expect(css).not.toMatch(/#link-help\s*\{[^}]*min-height/);
    // ... and the form as a whole keeps a fixed height, so the detector below does not move with the text.
    expect(css).toMatch(/\.link-form\s*\{[^}]*min-height:\s*\d+(\.\d+)?em/);
  });

  it("leaves a gap between Get credits and the detector", () => {
    expect(css).toMatch(/\.detector\s*\{[^}]*margin:\s*var\(--space-4\)/);
  });
});

describe("the Get credits button needs a link", () => {
  const go = (root: HTMLElement): HTMLButtonElement => $(root, '[data-key="go"]') as HTMLButtonElement;
  const type = (root: HTMLElement, text: string): void => {
    const input = $(root, "#link") as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("cannot be pressed while the link box is empty", async () => {
    const { root } = await mount();
    expect(go(root).disabled).toBe(true);
  });

  it("can be pressed once something is typed, and not again when it is cleared or only spaces", async () => {
    const { root } = await mount();
    type(root, "https://music.apple.com/us/album/x/1");
    expect(go(root).disabled).toBe(false);
    type(root, "   ");
    expect(go(root).disabled).toBe(true);
    type(root, "");
    expect(go(root).disabled).toBe(true);
  });

  it("can be pressed at once when the link is filled in from the page the user is on", async () => {
    const { root } = await mount({ tab: { tabId: 3, url: ALBUM.url } });
    expect(go(root).disabled).toBe(false);
  });

  it("does not start a read when Enter is pressed in an empty box", async () => {
    const { root, env } = await mount();
    ($(root, "form") as HTMLFormElement).requestSubmit();
    await flush();
    expect(env.api.calls.some((call) => call.startsWith("detect:"))).toBe(false);
  });
});

describe("an Apple Music album address with a song picked", () => {
  it("is listed as the Album, named by its header, and Get credits reads the whole album", async () => {
    const withSong = `${ALBUM.url}?i=1739659140`;
    const { root, env } = await mount({
      openTabs: [
        {
          tabId: 1,
          url: withSong,
          title: "LONELY AT THE TOP - Song with Lyrics by Joey Bada$$ - Apple Music",
          pageTitle: "Lonely At The Top",
          pageArtist: "Joey Bada$$",
          current: true,
        },
      ],
    });
    const item = $(root, '[data-key="open-page-0"]');
    expect(item.querySelector(".open-name")?.textContent).toBe("Joey Bada$$ - Lonely At The Top");
    expect(item.querySelector(".tag")?.textContent).toBe("Apple Music · Album · this page");
    item.click();
    await flush();
    expect(env.api.calls[0]).toContain(withSong);
  });
});
