// The card on a Genius song page: "This song on Apple Music and Spotify", one row per service in the style of the
// open-pages list. A found page is a button (Get credits); a service with no exact match says so, and a look-up that
// did not finish says that, with one "Try again" for the card. Shown on no other page.
import type { ServiceMatch } from "../shared/messages";
import { el } from "./dom";
import type { GeniusSongState, PanelState } from "./panelState";
import type { ViewContext } from "./viewContext";

const NO_MATCH = "No exact match found";
const COULD_NOT = "Could not look this up";

/** The source note of a found page, so the user knows how much to trust it. */
const sourceNote = (match: Extract<ServiceMatch, { status: "found" }>): string =>
  match.source === "genius" ? "from Genius" : "found by search";

function foundRow(
  v: ViewContext,
  state: PanelState,
  key: string,
  service: string,
  match: Extract<ServiceMatch, { status: "found" }>,
): HTMLElement {
  const busy = state.busy !== null;
  return el(
    "li",
    {},
    el(
      "button",
      {
        class: "button track detected",
        attrs: {
          type: "button",
          "data-key": `match-${key}`,
          "aria-label": `Get credits for ${match.name} on ${service}`,
          ...(busy ? { disabled: "" } : {}),
        },
        on: {
          click: () => {
            v.draft = match.url;
            void v.panel.getCreditsFromGenius(match.url);
          },
        },
      },
      el(
        "span",
        { class: "body" },
        el("span", { class: "open-name name", text: match.name }),
        el("span", {
          class: "tag",
          text: [service, match.release, sourceNote(match)].filter(Boolean).join(" · "),
        }),
      ),
      el("span", { class: "go", text: "Get credits", attrs: { "aria-hidden": "true" } }),
    ),
  );
}

function noteRow(key: string, service: string, text: string): HTMLElement {
  return el(
    "li",
    { class: "match-note", attrs: { "data-key": `match-${key}` } },
    el("span", { class: "open-name name", text: service }),
    el("span", { class: "tag", text }),
  );
}

function row(v: ViewContext, state: PanelState, key: string, service: string, match: ServiceMatch | null): HTMLElement {
  if (!match) return noteRow(key, service, "Looking…");
  if (match.status === "found") return foundRow(v, state, key, service, match);
  return noteRow(key, service, match.status === "none" ? NO_MATCH : COULD_NOT);
}

/** The card for the Genius page on screen, or nothing when the user is not on a Genius song page. */
export function songMatchesCard(v: ViewContext, state: PanelState): Node[] {
  const song = state.geniusSong;
  if (!song) return [];
  if (song.phase === "idle") return idleCard(v, state);
  const loading = song.phase === "loading";
  const failed = song.phase === "failed";
  const anyFailed = song.apple?.status === "failed" || song.spotify?.status === "failed";
  const found = song.apple?.status === "found" || song.spotify?.status === "found";
  const title = loading ? "Looking for this song on Apple Music and Spotify…" : "This song on Apple Music and Spotify";
  const hint = loading
    ? "Finding its pages from what Genius knows."
    : failed
      ? `${COULD_NOT}. ${song.message}`
      : found
        ? "Pick one to get its credits."
        : "Genius and a search found no exact match. Paste a link below.";
  return [
    el(
      "section",
      {
        class: "detector",
        attrs: {
          "data-key": "song-matches",
          "data-state": loading ? "listening" : found ? "found" : "idle",
          "aria-label": "This song on Apple Music and Spotify",
        },
      },
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
      loading || failed ? null : matchRows(v, state, song),
      failed || anyFailed ? findButton(v, state, "Try again", "quiet") : null,
    ),
  ];
}

function matchRows(v: ViewContext, state: PanelState, song: GeniusSongState): HTMLElement {
  return el(
    "ul",
    { class: "open-pages" },
    row(v, state, "apple", "Apple Music", song.apple),
    row(v, state, "spotify", "Spotify", song.spotify),
  );
}

function findButton(v: ViewContext, state: PanelState, text: string, variant: "primary" | "quiet"): HTMLElement {
  return v.button(text, variant, "song-matches-find", () => void v.panel.findSongMatches(), state.busy !== null);
}

/** On a Genius song page with the automatic look-up off: a button, and nothing is looked up until it is pressed. */
function idleCard(v: ViewContext, state: PanelState): Node[] {
  return [
    el(
      "section",
      {
        class: "detector",
        attrs: {
          "data-key": "song-matches",
          "data-state": "idle",
          "aria-label": "This song on Apple Music and Spotify",
        },
      },
      el(
        "div",
        { class: "detector-text" },
        el("h3", { class: "detector-title", text: "This song on Apple Music and Spotify" }),
        el("p", {
          class: "detector-hint",
          text: "You are on a Genius song page. Find its pages to get their credits. Nothing is looked up until you press the button.",
        }),
      ),
      findButton(v, state, "Find on Apple Music and Spotify", "primary"),
    ),
  ];
}
