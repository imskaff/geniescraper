import { afterEach, describe, expect, it } from "vitest";
import type { GeniusOpenAnswer, Result } from "../../src/shared/messages";
import { PanelController } from "../../src/ui/controller";
import { DEFAULT_SETTINGS } from "../../src/shared/settings";
import { PanelView } from "../../src/ui/view";
import { ALBUM, deferred, fakeEnv } from "./fakes";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

const $ = (root: ParentNode, selector: string): HTMLElement => {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};
const button = (root: ParentNode, text: string): HTMLButtonElement => {
  const node = [...root.querySelectorAll("button")].find((b) => b.textContent.startsWith(text));
  if (!node) throw new Error(`no button ${text}`);
  return node;
};
const has = (root: ParentNode, text: string): boolean =>
  [...root.querySelectorAll("button")].some((b) => b.textContent.startsWith(text));

const SONG = { title: "One", artists: ["Demo Artist"], url: "https://genius.com/Demo-artist-one-lyrics" };
const ok = (data: GeniusOpenAnswer): Promise<Result<GeniusOpenAnswer>> => Promise.resolve({ ok: true, data });

type Options = Parameters<typeof fakeEnv>[0];

async function toReview(options: Options = {}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const env = fakeEnv(options);
  const panel = await PanelController.create(env);
  new PanelView(root, panel);
  await panel.detect(ALBUM.url);
  await panel.setAllSelected(true);
  await panel.getCredits();
  await panel.showTrack(0);
  await flush();
  return { root, env, panel };
}

const pasteCalls = (calls: string[]): string[] => calls.filter((call) => call.startsWith("paste:"));
const geniusCalls = (calls: string[]): string[] => calls.filter((call) => call.startsWith("genius-open:"));

afterEach(() => {
  document.body.replaceChildren();
});

describe("Open on Genius button", () => {
  it("sits beside Start pasting for the track on screen, named for the song", async () => {
    const { root } = await toReview();
    const open = button(root, "Open on Genius");
    expect(open.getAttribute("aria-label")).toBe("Open One on Genius");
    expect(open.classList.contains("quiet")).toBe(true);
    expect(has(root, "Start pasting")).toBe(true);
  });

  it("is not offered before the credits are in", async () => {
    document.body.replaceChildren();
    const root = document.createElement("div");
    document.body.append(root);
    const panel = await PanelController.create(fakeEnv());
    new PanelView(root, panel);
    await panel.detect(ALBUM.url);
    await flush();
    expect(has(root, "Open on Genius")).toBe(false);
  });

  it("asks for this track's title and artist, opens the form and does not start pasting", async () => {
    const { root, env, panel } = await toReview({ api: { openOnGenius: () => ok({ status: "opened", song: SONG }) } });
    button(root, "Open on Genius").click();
    await flush();
    expect(geniusCalls(env.api.calls)).toEqual(["genius-open:Demo Artist|One"]);
    expect(pasteCalls(env.api.calls)).toEqual([]);
    expect(panel.state.genius.phase).toBe("opened");
    expect($(root, '[data-key="genius-notice"]').textContent).toContain("The edit form for “One” is open on Genius.");
    // Start pasting is still the user's next move, and it did not open anything again.
    expect(has(root, "Start pasting")).toBe(true);
  });

  it("shows that it is looking, with the button disabled, until Genius answers", async () => {
    const answer = deferred<Result<GeniusOpenAnswer>>();
    const { root, panel } = await toReview({ api: { openOnGenius: () => answer.promise } });
    button(root, "Open on Genius").click();
    await flush();
    expect(panel.state.genius.phase).toBe("working");
    expect(button(root, "Open on Genius").disabled).toBe(true);
    expect($(root, "#status").textContent).toBe("Looking for “One” on Genius…");
    answer.resolve({ ok: true, data: { status: "opened" } });
    await flush();
    expect(button(root, "Open on Genius").disabled).toBe(false);
  });

  it("does not ask twice while it is working", async () => {
    const answer = deferred<Result<GeniusOpenAnswer>>();
    const { env, panel } = await toReview({ api: { openOnGenius: () => answer.promise } });
    void panel.openOnGenius(0);
    void panel.openOnGenius(0);
    await flush();
    expect(geniusCalls(env.api.calls)).toHaveLength(1);
  });
});

describe("what it says when it cannot go on", () => {
  const CASES: [string, GeniusOpenAnswer, string][] = [
    ["none", { status: "none" }, "Genius has no song that matches “One” exactly"],
    ["sign-in", { status: "sign-in", song: SONG }, "has no Edit Metadata button"],
    ["no-form", { status: "no-form", song: SONG }, "its edit form did not"],
    ["failed", { status: "failed" }, "Genius did not answer"],
    ["busy", { status: "busy" }, "Automatic pasting is running"],
  ];

  it.each(CASES)("%s: tells the user, assertively, and nothing starts", async (_name, answer, words) => {
    const { root, env } = await toReview({ api: { openOnGenius: () => ok(answer) } });
    button(root, "Open on Genius").click();
    await flush();
    expect($(root, "#alert").textContent).toContain(words);
    expect($(root, '[data-key="genius-notice"]').classList.contains("attention")).toBe(true);
    expect(pasteCalls(env.api.calls)).toEqual([]);
  });

  it("links the page that opened when sign-in or the form is the problem", async () => {
    const { root } = await toReview({ api: { openOnGenius: () => ok({ status: "sign-in", song: SONG }) } });
    button(root, "Open on Genius").click();
    await flush();
    const link = $(root, ".genius-links a") as HTMLAnchorElement;
    expect(link.href).toBe(SONG.url);
    expect(link.rel).toContain("noopener");
  });

  it("lists every candidate as a plain link when several match, and picks none", async () => {
    const songs = [
      SONG,
      { title: "One", artists: ["Demo Artist"], url: "https://genius.com/Demo-artist-one-2-lyrics" },
    ];
    const { root, env } = await toReview({ api: { openOnGenius: () => ok({ status: "several", songs }) } });
    button(root, "Open on Genius").click();
    await flush();
    const links = [...root.querySelectorAll<HTMLAnchorElement>(".genius-links a")];
    expect(links.map((a) => a.href)).toEqual(songs.map((song) => song.url));
    expect(links.every((a) => a.target === "_blank")).toBe(true);
    expect(pasteCalls(env.api.calls)).toEqual([]);
  });

  it("tells the user to reload the extension when its background part does not know the request", async () => {
    const { root, panel } = await toReview({
      api: { openOnGenius: () => Promise.resolve({ ok: false, error: { code: "bad-request", message: "x" } }) },
    });
    button(root, "Open on Genius").click();
    await flush();
    expect(panel.state.error).toContain("Reload");
  });

  it("shows the notice only for the track it was about, and forgets it on leaving", async () => {
    const { root, panel } = await toReview({ api: { openOnGenius: () => ok({ status: "none" }) } });
    button(root, "Open on Genius").click();
    await flush();
    expect(root.querySelector('[data-key="genius-notice"]')).not.toBeNull();
    await panel.showTrack(0); // closes it: the track Start pasting means is now the first ready one, still track 0
    await panel.showTrack(2);
    await flush();
    expect(root.querySelector('[data-key="genius-notice"]')).toBeNull();
    await panel.newAlbum();
    expect(panel.state.genius.phase).toBe("idle");
  });
});

describe("the setting: open each song on Genius before pasting it", () => {
  it("is off by default, and Start pasting then never touches Genius", async () => {
    expect(DEFAULT_SETTINGS.openOnGenius).toBe(false);
    const { env, panel } = await toReview();
    await panel.startPaste(0, "manual");
    expect(geniusCalls(env.api.calls)).toEqual([]);
    expect(pasteCalls(env.api.calls)).toContain("paste:paste-start");
  });

  it("opens the song first, and pastes only once the form is open", async () => {
    const { env, panel } = await toReview({
      settings: { openOnGenius: true },
      api: { openOnGenius: () => ok({ status: "opened", song: SONG }) },
    });
    await panel.startPaste(0, "manual");
    const order = env.api.calls.filter((call) => call.startsWith("genius-open:") || call === "paste:paste-start");
    expect(order).toEqual(["genius-open:Demo Artist|One", "paste:paste-start"]);
    expect(panel.state.genius.phase).toBe("idle");
  });

  it.each<GeniusOpenAnswer>([
    { status: "none" },
    { status: "several", songs: [SONG, SONG] },
    { status: "sign-in", song: SONG },
    { status: "no-form", song: SONG },
    { status: "failed" },
  ])("does not paste when the answer is $status", async (answer) => {
    const { env, panel } = await toReview({
      settings: { openOnGenius: true },
      api: { openOnGenius: () => ok(answer) },
    });
    await panel.startPaste(0, "manual");
    expect(pasteCalls(env.api.calls)).toEqual([]);
    expect(panel.state.paste.active).toBe(false);
    expect(panel.state.genius.phase).toBe(answer.status);
  });

  it("opens the next song from the finished screen, and stays there when it cannot", async () => {
    const answers: GeniusOpenAnswer[] = [{ status: "opened" }, { status: "none" }, { status: "opened" }];
    let asked = 0;
    const { root, env, panel } = await toReview({
      settings: { openOnGenius: true },
      api: { openOnGenius: () => ok(answers[asked++] ?? { status: "failed" }) },
    });
    await panel.startPaste(0, "manual");
    env.api.pasteState = { ...env.api.pasteState, position: env.api.pasteState.queue.length };
    panel.setPaste(env.api.pasteState);
    await flush();
    expect($(root, "h2").textContent).toBe("All credits entered");

    button(root, "Paste next track").click();
    await flush();
    // No exact match for the next song: nothing was pasted, and the finished screen says why.
    expect($(root, "h2").textContent).toBe("All credits entered");
    expect($(root, '[data-key="genius-notice"]').textContent).toContain("Genius has no song that matches “Three”");
    expect(pasteCalls(env.api.calls).filter((call) => call === "paste:paste-start")).toHaveLength(1);

    button(root, "Paste next track").click();
    await flush();
    expect($(root, "h2").textContent).toMatch(/^Demo Artist - [A-Za-z]+$/);
    expect(env.api.pasteState.title).toBe("Three");
  });

  it("is a checkbox in Settings that is saved", async () => {
    const { root, env, panel } = await toReview();
    panel.openSettings();
    await flush();
    const box = $(root, '[data-key="setting-openOnGenius"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await flush();
    expect(panel.state.settings.openOnGenius).toBe(true);
    expect(env.settingsStore.data.get("settings")).toMatchObject({ openOnGenius: true });
  });
});

describe("Open on Genius beside the paste screen's heading", () => {
  async function pasting(options: Options = {}) {
    const ui = await toReview(options);
    await ui.panel.startPaste(0, "manual");
    await flush();
    return ui;
  }

  it("titles the screen 'Artist - Song name' with a plain dash, and says so once", async () => {
    const { root } = await pasting();
    const heading = $(root, "h2");
    expect(heading.textContent).toBe("Demo Artist - One");
    expect(heading.textContent).not.toContain("—");
    // The song name is not repeated under the heading any more.
    expect(root.querySelectorAll(".help").length).toBeGreaterThan(0);
    expect([...root.querySelectorAll("p")].some((p) => p.textContent === "One")).toBe(false);
  });

  it("puts a labelled control next to the heading that does what the review button does", async () => {
    const { root, env, panel } = await pasting({ api: { openOnGenius: () => ok({ status: "opened", song: SONG }) } });
    const head = $(root, ".screen-head");
    const open = head.querySelector<HTMLButtonElement>("button");
    expect(open?.textContent).toBe("Open on Genius");
    expect(open?.getAttribute("aria-label")).toBe("Open One on Genius");
    expect(head.firstElementChild?.tagName).toBe("H2");
    open?.click();
    await flush();
    expect(geniusCalls(env.api.calls)).toEqual(["genius-open:Demo Artist|One"]);
    expect(panel.state.genius.phase).toBe("opened");
    expect($(root, "#status").textContent).toContain("The edit form for “One” is open");
    // The paste carries on from where it was: nothing was restarted.
    expect(pasteCalls(env.api.calls).filter((c) => c === "paste:paste-start")).toHaveLength(1);
  });

  it.each<[string, GeniusOpenAnswer, string]>([
    ["none", { status: "none" }, "matches “One” exactly"],
    ["several", { status: "several", songs: [SONG, SONG] }, "Several Genius pages"],
    ["sign-in", { status: "sign-in", song: SONG }, "no Edit Metadata button"],
  ])("shows the %s state once, under the heading", async (_name, answer, words) => {
    const { root } = await pasting({ api: { openOnGenius: () => ok(answer) } });
    $(root, ".screen-head button").click();
    await flush();
    expect($(root, '[data-key="genius-notice"]').textContent).toContain(words);
    expect($(root, "#alert").textContent).toContain(words);
    // The red paste error box does not repeat the notice.
    expect(root.querySelector(".paste-error")).toBeNull();
  });

  it("is disabled while searching", async () => {
    const answer = deferred<Result<GeniusOpenAnswer>>();
    const { root } = await pasting({ api: { openOnGenius: () => answer.promise } });
    $(root, ".screen-head button").click();
    await flush();
    expect(($(root, ".screen-head button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("pauses a running automatic paste first, so the new page does not pause it by surprise", async () => {
    const ui = await toReview();
    await ui.panel.startPaste(0, "auto");
    await flush();
    expect(ui.panel.state.paste.auto).toBe("running");
    $(ui.root, ".screen-head button").click();
    await flush();
    const order = ui.env.api.calls.filter((c) => c === "paste:paste-auto-pause" || c.startsWith("genius-open:"));
    expect(order).toEqual(["paste:paste-auto-pause", "genius-open:Demo Artist|One"]);
    expect(ui.panel.state.paste.auto).toBe("paused");
  });

  it("is not shown, and the heading is just the song, when it is not known which track is being pasted", async () => {
    document.body.replaceChildren();
    const root = document.createElement("div");
    document.body.append(root);
    const env = fakeEnv();
    env.sessionStore.data.set("paste", {
      active: true,
      title: "Song",
      queue: [["written_by", "Writer One"]],
      position: 0,
      awaiting: false,
      busy: false,
      busySince: 0,
      message: "",
      tone: "info",
    });
    new PanelView(root, await PanelController.create(env));
    expect($(root, "h2").textContent).toBe("Song");
    expect(root.querySelector(".screen-head button")).toBeNull();
  });
});
