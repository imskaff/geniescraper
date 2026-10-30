// The link screen, the open-pages detector and the track list.
import { type AlbumInfo } from "../shared/messages";
import { el } from "./dom";
import { type PanelState } from "./controller";
import { type ViewContext } from "./viewContext";

export function linkScreen(v: ViewContext, state: PanelState): Node[] {
  const busy = state.busy === "detect";
  const start = v.draft ?? state.pageUrl;
  // Get credits needs a link: it stays off while the box is empty and while a page is being read.
  const go = el(
    "button",
    {
      class: "button primary",
      attrs: {
        type: "submit",
        "data-key": "go",
        ...(busy ? { "aria-label": "Reading the page…" } : {}),
        ...(busy || start.trim() === "" ? { disabled: "" } : {}),
      },
    },
    "Get credits",
    // Three dots that light up one after another while the page is read.
    busy
      ? el(
          "span",
          { class: "dots", attrs: { "aria-hidden": "true" } },
          el("i", { text: "." }),
          el("i", { text: "." }),
          el("i", { text: "." }),
        )
      : null,
  );
  const input = el("input", {
    class: "field",
    attrs: {
      id: "link",
      "data-key": "link",
      type: "url",
      name: "link",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "https://music.apple.com/…",
      "aria-describedby": "link-help",
      ...(state.error ? { "aria-invalid": "true" } : {}),
    },
    on: {
      input: (event) => {
        v.draft = (event.target as HTMLInputElement).value;
        go.disabled = busy || v.draft.trim() === "";
      },
    },
  });
  input.value = start;

  const form = el(
    "form",
    {
      class: "stack link-form",
      attrs: { novalidate: "" },
      on: {
        submit: (event) => {
          event.preventDefault();
          v.draft = input.value;
          void v.panel.detect(input.value);
        },
      },
    },
    el("label", { text: "Apple Music album or song link", attrs: { for: "link" } }),
    input,
    el("p", {
      class: "help",
      text: state.pageUrl
        ? "You are on an Apple Music page, so its link is filled in. Paste another to use a different one."
        : "Open an album or song on Apple Music and paste its link.",
      attrs: { id: "link-help" },
    }),
    go,
  );
  return [v.heading("Get credits from Apple Music"), form, ...openPages(v, state)];
}

/**
 * The detector: listens for Apple Music pages already open in the browser. With none it says so and waits (the
 * radar animates); with some, it announces them and the page in view stands out. The status line is in the page
 * before anything is found, so a screen reader announces a detection instead of a new block appearing.
 */
export function openPages(v: ViewContext, state: PanelState): Node[] {
  const pages = state.appleTabs;
  const found = pages.length > 0;
  const busy = state.busy !== null;
  const title = !found
    ? "Listening for Apple Music pages…"
    : pages.length === 1
      ? "Apple Music page detected"
      : `${String(pages.length)} Apple Music pages detected`;
  const hint = found
    ? "Pick one to get its credits."
    : "Open an album or song on Apple Music in your browser and it shows up here.";
  const items = pages.map((page, index) =>
    el(
      "li",
      {},
      el(
        "button",
        {
          class: "button track detected",
          attrs: {
            type: "button",
            "data-key": `open-page-${String(index)}`,
            "aria-label": `Get tracks for ${page.name}${page.current ? ", the page you are on" : ""}`,
            ...(page.current ? { "data-current": "true" } : {}),
            ...(busy ? { disabled: "" } : {}),
          },
          on: {
            click: () => {
              v.draft = page.url;
              void v.panel.detect(page.url);
            },
          },
        },
        el(
          "span",
          { class: "body" },
          el("span", { class: "open-name name", text: page.name }),
          el("span", {
            class: "tag",
            text: `${page.kind === "album" ? "Album" : "Song"}${page.current ? " · this page" : ""}`,
          }),
        ),
        el("span", { class: "go", text: "Get credits", attrs: { "aria-hidden": "true" } }),
      ),
    ),
  );
  return [
    el(
      "section",
      { class: "detector", attrs: { "data-key": "open-pages", "data-state": found ? "found" : "listening" } },
      el(
        "div",
        { class: "detector-head", attrs: { "aria-live": "polite" } },
        el(
          "span",
          { class: "radar", attrs: { "aria-hidden": "true" } },
          el("i", {}),
          el("i", {}),
          el("i", {}),
          el("b", {}),
        ),
        el(
          "div",
          { class: "detector-text" },
          el("h3", { class: "detector-title", text: title }),
          el("p", { class: "detector-hint", text: hint }),
        ),
      ),
      found ? el("ul", { class: "open-pages" }, ...items) : null,
    ),
  ];
}

export function tracksScreen(v: ViewContext, state: PanelState): Node[] {
  const { album, selected } = state.session;
  if (!album) return linkScreen(v, state);
  const available = album.trackUrls.filter(Boolean).length;
  const busy = state.busy !== null;

  const list = el(
    "ul",
    { class: "tracks" },
    ...album.trackTitles.map((title, index) => trackRow(v, album, title, index, selected.includes(index))),
  );
  return [
    v.heading(album.albumTitle || "Tracks"),
    el("p", {
      class: "help",
      text: `${album.artist}: ${String(album.trackCount)} ${album.trackCount === 1 ? "track" : "tracks"}`,
    }),
    el(
      "fieldset",
      { class: "stack" },
      el("legend", { text: "Tracks to get credits for" }),
      el(
        "div",
        { class: "row" },
        // Nothing is picked to begin with, so the first move is highlighted, like the button it leads to.
        // Neither button disables itself after it is used: a disabled button drops keyboard focus.
        v.button("Select all", "primary", "all", () => void v.panel.setAllSelected(true), available === 0),
        v.button("Select none", "quiet", "none", () => void v.panel.setAllSelected(false), available === 0),
      ),
      list,
    ),
    el(
      "div",
      { class: "row" },
      v.button(
        `Get credits for ${String(selected.length)} ${selected.length === 1 ? "track" : "tracks"}`,
        "primary",
        "go",
        () => void v.panel.getCredits(),
        busy || selected.length === 0,
      ),
      v.button("Back to main menu", "nav", "menu", () => void v.panel.newAlbum(), false),
    ),
  ];
}

export function trackRow(
  v: ViewContext,
  album: AlbumInfo,
  title: string,
  index: number,
  checked: boolean,
): HTMLElement {
  const unavailable = !album.trackUrls[index];
  const box = el("input", {
    attrs: {
      type: "checkbox",
      "data-key": `track-${String(index)}`,
      ...(unavailable ? { disabled: "" } : {}),
    },
    on: {
      change: (event) => {
        void v.panel.setTrackSelected(index, (event.target as HTMLInputElement).checked);
      },
    },
  });
  box.checked = checked && !unavailable;
  return el(
    "li",
    {},
    el(
      "label",
      { class: unavailable ? "check muted" : "check" },
      box,
      el("span", { text: `${String(index + 1)}. ${title}` }),
      unavailable ? el("span", { class: "tag", text: "No Apple Music page" }) : null,
    ),
  );
}
