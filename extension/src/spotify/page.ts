// Reads open.spotify.com track and album pages: finds the options button, opens the "View credits" dialog with plain
// click() calls and parses it. Ported from the research reader (scripts/lib/spotify-read.mjs); the choices behind
// every selector are in docs/spotify-provider-notes.md. Nothing relies on class names (they are hashed) or on
// English text; the section headings and role names are localised, which the role table deals with.
import { splitRoles, type DialogRow, type ParsedDialog } from "./dialog";

const norm = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

export interface Timing {
  /** Longest wait for the options button after the page loaded. */
  buttonMs: number;
  /** Longest wait for the menu, and for its credits entry, after the click. */
  menuMs: number;
  /** Longest wait for the dialog after the entry was clicked. */
  dialogMs: number;
  /** Longest wait for an album's rows to appear and stop changing. */
  rowsMs: number;
  /** How long the row count must hold still to count as settled. */
  settleMs: number;
  /** Fallback re-check interval; mutations re-check at once, because a hidden tab throttles timers to about 1 Hz. */
  stepMs: number;
  /** Pause before trying a failed open a second time. */
  retryPauseMs: number;
}

export const REAL_TIMING: Timing = {
  buttonMs: 10_000,
  menuMs: 4_000,
  dialogMs: 5_000,
  rowsMs: 12_000,
  settleMs: 1_200,
  stepMs: 100,
  retryPauseMs: 500,
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Wait until `fn` returns something truthy or `ms` have passed (null). It re-checks on every DOM change as well as on
 * a timer, since mutation callbacks still run promptly in a tab that throttles its timers.
 */
export function until<T>(
  doc: Document,
  fn: () => T | null | undefined | false,
  ms: number,
  step = 100,
): Promise<T | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const end = Date.now() + ms;
    const finish = (value: T | null): void => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const check = (): void => {
      const value = fn();
      if (value) finish(value);
      else if (Date.now() >= end) finish(null);
      else timer = setTimeout(check, step);
    };
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      check();
    });
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true });
    check();
  });
}

// ---- finding things (language independent) ----

/** The track's (or, on an album page, the album's) options button in the action bar. */
export const findMoreButton = (doc: Document): HTMLElement | null =>
  doc.querySelector<HTMLElement>("[data-testid='action-bar-row'] button[data-testid='more-button']") ??
  doc.querySelector<HTMLElement>("main button[data-testid='more-button']");

/**
 * The "View credits" entry of the open menu, found by structure. Of the `button[role=menuitem]` entries with neither
 * `aria-disabled` nor `aria-expanded`, two exist: "View credits" and "Open in Desktop app". The credits entry is the
 * one followed by "Share", which has `aria-expanded`; requiring that follower means a menu without a credits entry
 * gives null and never the desktop-app entry, which would try to launch another program.
 */
export function findCreditsItem(doc: Document): HTMLElement | null {
  const items = [...doc.querySelectorAll<HTMLElement>("[role='menu'] [role='menuitem']")];
  return (
    items.find(
      (item, i) =>
        item.tagName === "BUTTON" &&
        !item.hasAttribute("aria-expanded") &&
        !item.hasAttribute("aria-disabled") &&
        items[i + 1]?.hasAttribute("aria-expanded") === true,
    ) ?? null
  );
}

/** The credits dialog: a native `<dialog aria-label>` (`role=dialog` is the language and country pickers). */
export const findDialog = (doc: Document): HTMLDialogElement | null =>
  doc.querySelector<HTMLDialogElement>("dialog[open][aria-label]:has([role='group'], h1)");

/** Text that appears on a bot wall. */
export const isBlocked = (doc: Document): boolean =>
  /captcha|unusual traffic|access denied|too many requests/i.test((doc.body.textContent || "").slice(0, 2000));

// ---- parsing ----

/**
 * Read the open credits dialog. A section is a div whose first child is a heading span, followed by its rows; a row is
 * a `[role=group][aria-labelledby]` with `span[dir=auto]` (name) and `[id^=listrow-subtitle-]` (roles). Artist rows are
 * labelled by `...spotify:artist:<id>`. "Sources" is the one group without a name span.
 */
export function parseDialog(dialog: Element): ParsedDialog {
  const rows: DialogRow[] = [];
  const sections: (Element | null)[] = [];
  let source = "";
  for (const group of dialog.querySelectorAll("[role='group'][aria-labelledby]")) {
    const nameEl = group.querySelector("span[dir='auto']");
    if (!nameEl) {
      const spans = [...group.querySelectorAll("span")].map((span) => norm(span.textContent));
      if (spans.length >= 2) source = spans.slice(1).join(", ");
      continue;
    }
    const container = group.parentElement;
    const first = container?.firstElementChild;
    const heading = first?.tagName === "SPAN" ? norm(first.textContent) : "";
    let sectionIndex = sections.indexOf(container);
    if (sectionIndex < 0) sectionIndex = sections.push(container) - 1;
    const label = group.getAttribute("aria-labelledby") ?? "";
    rows.push({
      section: heading,
      sectionIndex,
      name: norm(nameEl.textContent),
      roles: splitRoles(group.querySelector("[id^='listrow-subtitle-']")?.textContent ?? ""),
      artistId: /spotify:artist:([A-Za-z0-9]+)/.exec(label)?.[1] ?? null,
    });
  }
  return {
    heading: norm(dialog.querySelector("h1")?.textContent),
    title: norm(dialog.querySelector("h2")?.textContent),
    rows,
    source,
  };
}

export type ReadStatus = "ok" | "no-credits" | "no-button" | "no-menu" | "no-item" | "no-dialog" | "blocked";

export interface ReadResult {
  status: ReadStatus;
  dialog?: ParsedDialog;
  /** Milliseconds from the start of the read to each stage, for measuring where the time goes. */
  steps?: Record<string, number>;
}

/** One turn of the event loop through a message channel: unlike `setTimeout`, a hidden tab does not throttle it. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(0);
  });
}

/** Wait until the dialog's rows have not changed for 40 ms (at most half a second), turn by turn, never on a timer. */
async function settled(dialog: Element): Promise<void> {
  const count = (): number => dialog.querySelectorAll("[role='group']").length;
  const start = Date.now();
  let changed = start;
  let last = count();
  while (Date.now() - changed < 40 && Date.now() - start < 500) {
    await nextTask();
    const now = count();
    if (now !== last) {
      last = now;
      changed = Date.now();
    }
  }
}

/**
 * Open the dialog from the options button and read it. Never throws for page problems; `status` says what happened:
 * ok (the dialog has credit rows), no-credits (it opened empty), no-button (no options button: wrong page or track
 * unavailable), no-menu, no-item (a menu without a credits entry), no-dialog (entry clicked, nothing opened) and
 * blocked (a captcha or limit text is showing). A click that did nothing, seen once on a cold first load, is retried
 * once after closing the menu.
 */
export async function readCredits(doc: Document, timing: Timing, button?: HTMLElement): Promise<ReadResult> {
  if (isBlocked(doc)) return { status: "blocked" };
  const t0 = Date.now();
  const steps: Record<string, number> = {};
  const mark = (name: string): void => {
    steps[name] = Date.now() - t0;
  };
  const more = button ?? (await until(doc, () => findMoreButton(doc), timing.buttonMs, timing.stepMs));
  mark("button");
  if (!more) return { status: isBlocked(doc) ? "blocked" : "no-button" };
  let last: ReadStatus = "no-menu";
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      // Leave no menu behind (the button toggles it), then try again.
      if (doc.querySelector("[role='menu']")) more.click();
      await until(doc, () => !doc.querySelector("[role='menu']"), 1500, timing.stepMs);
      await sleep(timing.retryPauseMs);
    }
    more.click();
    const item = await until(doc, () => findCreditsItem(doc), timing.menuMs, timing.stepMs);
    mark("menu");
    if (!item) {
      last = doc.querySelector("[role='menu'] [role='menuitem']") ? "no-item" : "no-menu";
      continue;
    }
    item.click();
    const dialog = await until(doc, () => findDialog(doc), timing.dialogMs, timing.stepMs);
    mark("dialog");
    if (!dialog) {
      last = "no-dialog";
      continue;
    }
    // The rows come with the dialog; a late second render is caught by waiting until the row count holds still.
    await settled(dialog);
    const parsed = parseDialog(dialog);
    mark("parsed");
    return { status: parsed.rows.length > 0 ? "ok" : "no-credits", dialog: parsed, steps };
  }
  if (doc.querySelector("[role='menu']")) more.click();
  return { status: isBlocked(doc) ? "blocked" : last };
}

// ---- header facts ----

export interface Header {
  title: string;
  artists: string[];
  /** Printed year of release ("" when the page shows none); a track page prints only the year. */
  year: string;
}

export function readHeader(doc: Document): Header {
  return {
    title: norm(doc.querySelector("[data-testid='entityTitle']")?.textContent),
    artists: [...doc.querySelectorAll("[data-testid='entity-header'] [data-testid='creator-link']")]
      .map((a) => norm(a.textContent))
      .filter(Boolean),
    year: norm(doc.querySelector("[data-testid='release-date']")?.textContent),
  };
}

/** The ℗ and © lines of a page's main area; the footer's "© <year> Spotify AB" is not one of them. */
export function readCopyright(doc: Document): { phonographic: string; copyright: string } {
  const out = { phonographic: "", copyright: "" };
  for (const el of doc.querySelectorAll("main p, main span")) {
    if (el.children.length > 0 || el.closest("[data-testid='footer-div'], footer")) continue;
    const text = norm(el.textContent);
    if (text.startsWith("℗") && !out.phonographic) out.phonographic = text;
    else if (text.startsWith("©") && !out.copyright) out.copyright = text;
  }
  return out;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * The album's release date from the line above its copyright block ("March 20, 2020"), as "YYYY-MM-DD". The text is
 * localised, so only the English form is understood; anything else gives "" rather than a guess.
 */
export function readAlbumReleaseDate(doc: Document): string {
  for (const el of doc.querySelectorAll("main p, main span")) {
    if (el.children.length > 0 || el.closest("[data-testid='footer-div'], footer")) continue;
    const match = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(norm(el.textContent));
    const month = match?.[1] ? MONTHS.indexOf(match[1].toLowerCase()) : -1;
    if (match?.[2] && match[3] && month >= 0) {
      return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    }
  }
  return "";
}

// ---- album tracks ----

export interface AlbumRow {
  id: string;
  title: string;
}

/** The track rows present in the page right now, in order, each once. */
export function trackRows(doc: Document): AlbumRow[] {
  const rows: AlbumRow[] = [];
  for (const row of doc.querySelectorAll("[data-testid='tracklist-row']")) {
    const link = row.querySelector("a[data-testid='internal-track-link'][href^='/track/']");
    const id = /^\/track\/([A-Za-z0-9]{22})/.exec(link?.getAttribute("href") ?? "")?.[1];
    if (id && link && !rows.some((r) => r.id === id)) rows.push({ id, title: norm(link.textContent) });
  }
  return rows;
}

/**
 * The track count printed in an album header ("2010 • 100 songs, about 6 hr"): the integer in the part after the year.
 * Null when it cannot be found, which a caller treats as "do not trust the list to be complete".
 */
export function readAlbumTrackCount(doc: Document): number | null {
  const header = doc.querySelector("[data-testid='entity-header']");
  const parts = (header?.textContent ?? "").split("•").map(norm);
  const year = norm(doc.querySelector("[data-testid='release-date']")?.textContent);
  const at = parts.findIndex((part) => /^[0-9]{4}$/.test(part) || (year !== "" && part === year));
  const n = Number(/[0-9]+/.exec(parts[at + 1] ?? "")?.[0]);
  return at >= 0 && n > 0 ? n : null;
}

/**
 * True when the list already holds every track the header prints and the copyright and date lines below it have
 * rendered too, so waiting for the count to hold still would only add time. Anything missing falls back to settling.
 */
function albumComplete(doc: Document, rows: number): boolean {
  const copyright = readCopyright(doc);
  return (
    readAlbumTrackCount(doc) === rows &&
    (copyright.phonographic !== "" || copyright.copyright !== "") &&
    readAlbumReleaseDate(doc) !== ""
  );
}

/**
 * The album's tracks once the list has settled. A long album is a windowed list that renders only its first rows
 * (about 25) and grows only by scrolling a visible tab, so this does not scroll: it returns the rows there are and the
 * count the header prints, and the caller makes the gap visible.
 */
export async function readAlbumRows(
  doc: Document,
  timing: Timing,
): Promise<{ rows: AlbumRow[]; expected: number | null }> {
  const end = Date.now() + timing.rowsMs;
  let last = -1;
  let since = Date.now();
  while (Date.now() < end) {
    const n = trackRows(doc).length;
    if (n > 0 && albumComplete(doc, n)) break;
    if (n !== last) {
      last = n;
      since = Date.now();
    } else if (n > 0 && Date.now() - since >= timing.settleMs) break;
    await until(doc, () => trackRows(doc).length !== n, Math.min(150, timing.stepMs * 2), timing.stepMs);
  }
  return { rows: trackRows(doc), expected: readAlbumTrackCount(doc) };
}
