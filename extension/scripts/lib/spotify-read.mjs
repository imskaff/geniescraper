// Reference reader for open.spotify.com track and album pages (signed out): finds the options button, opens the
// "View credits" dialog with plain click() calls and parses it. It is a research artefact, not shipped code: the
// future provider's logic is meant to be ported from it, and docs/spotify-provider-notes.md explains every choice.
//
// `spotifyReader()` is deliberately one self-contained function with no outer references, so that
// `readerSource` (its text) can be injected into a page, a content script or a throwaway test extension unchanged,
// and the same function can run in Node against a saved page (see test/spotify/reader.test.ts).
//
// Nothing here relies on class names (they are hashed and change) or on English text, except two documented
// fallbacks: the section headings and role names are only localized when the page is not asked for English.
// Pages are asked for English with the `/intl-en/` URL prefix (see `trackUrl`).

/* global document, MutationObserver, clearTimeout, DOMParser */

/** The reader. Call it once per document: `const reader = spotifyReader(); await reader.readCredits(document)`. */
export function spotifyReader() {
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Wait until `fn` returns something truthy or the time is up. Re-checks on every DOM change as well as on a timer:
   * a hidden tab throttles timers to about one a second, but mutation callbacks still run promptly.
   */
  function until(fn, ms, step = 100) {
    return new Promise((resolve) => {
      const root = document.documentElement;
      let timer;
      let observer;
      const finish = (value) => {
        observer?.disconnect();
        clearTimeout(timer);
        resolve(value);
      };
      const end = Date.now() + ms;
      const check = () => {
        const value = fn();
        if (value) finish(value);
        else if (Date.now() >= end) finish(null);
        else timer = setTimeout(check, step);
      };
      observer = new MutationObserver(() => {
        clearTimeout(timer);
        check();
      });
      observer.observe(root, { subtree: true, childList: true, attributes: true });
      check();
    });
  }

  // ---- finding things (language independent) ----

  /** The track's (or, on an album page, the album's) options button in the action bar. */
  const findMoreButton = (doc) =>
    doc.querySelector("[data-testid='action-bar-row'] button[data-testid='more-button']") ??
    doc.querySelector("main button[data-testid='more-button']");

  /** An album page's per-track options buttons, keyed by track id, from the tracklist rows. */
  function trackRows(doc) {
    const rows = [];
    for (const row of doc.querySelectorAll("[data-testid='tracklist-row']")) {
      const link = row.querySelector("a[data-testid='internal-track-link'][href^='/track/']");
      const id = /^\/track\/([A-Za-z0-9]+)/.exec(link?.getAttribute("href") ?? "")?.[1];
      if (!id) continue;
      rows.push({
        id,
        title: norm(link.textContent),
        number: Number(norm(row.querySelector("[aria-colindex='1'] > div > span")?.textContent)) || null,
        explicit: !!row.querySelector("[role='img'][aria-label][title]"),
        el: row,
        more: row.querySelector("button[data-testid='more-button']"),
      });
    }
    return rows;
  }

  /**
   * The track count printed in an album header ("2010 • 100 songs, about 6 hr"): the integer in the part after the
   * year. Language independent as long as the page uses Western digits; null when it cannot be found.
   */
  function readAlbumTrackCount(doc) {
    const header = doc.querySelector("[data-testid='entity-header']");
    const parts = (header?.textContent ?? "").split("•").map(norm);
    const year = norm(doc.querySelector("[data-testid='release-date']")?.textContent);
    const at = parts.findIndex((p) => /^[0-9]{4}$/.test(p) || (year && p === year));
    const n = Number(/[0-9]+/.exec(parts[at + 1] ?? "")?.[0]);
    return at >= 0 && n > 0 ? n : null;
  }

  /**
   * The album's tracks. Rows appear in batches, and a long album is a windowed list: the first ~25 rows render, more
   * appear (and old ones are recycled) as the list is scrolled, which only happens in a visible tab (a hidden one
   * stayed at 25 of 100). So: wait until the count settles, scroll the last row into view while that adds rows, and
   * keep what was seen in `tracks`. `rows` are the rows in the DOM right now (with their buttons). `complete` is true
   * when `tracks` covers 1..expected, `expected` being the header's track count.
   */
  async function readAlbumTracks(doc, { settleMs = 1200, timeoutMs = 12000, maxScrolls = 40 } = {}) {
    const seen = new Map();
    const remember = () => {
      for (const row of trackRows(doc))
        seen.set(row.id, { id: row.id, title: row.title, number: row.number, explicit: row.explicit });
    };
    const end = Date.now() + timeoutMs;
    let last = -1;
    let since = Date.now();
    while (Date.now() < end) {
      const n = trackRows(doc).length;
      if (n !== last) {
        last = n;
        since = Date.now();
      } else if (n > 0 && Date.now() - since >= settleMs) break;
      await sleep(150);
    }
    remember();
    const first = trackRows(doc);
    let scrolls = 0;
    for (; scrolls < maxScrolls; scrolls++) {
      const before = trackRows(doc);
      before.at(-1)?.el.scrollIntoView({ block: "end" });
      const grew = await until(() => trackRows(doc).at(-1)?.id !== before.at(-1)?.id, 2500);
      if (!grew) break;
      await sleep(200);
      remember();
    }
    const tracks = [...seen.values()].sort((x, y) => (x.number ?? 0) - (y.number ?? 0));
    const expected = readAlbumTrackCount(doc);
    return {
      rows: first,
      tracks,
      scrolls,
      expected,
      complete: expected !== null && tracks.length === expected && tracks.every((r, i) => r.number === i + 1),
    };
  }

  /**
   * The "View credits" entry of the open menu. Found by structure, not text. The menu's `button[role=menuitem]`
   * entries that have neither `aria-disabled` nor `aria-expanded` are "View credits" and "Open in Desktop app"; the
   * credits one is the first of them and is followed by "Share", which has `aria-expanded`. Requiring that follower
   * (or, failing that, the text match) means a menu without a credits entry yields null instead of the
   * desktop-app entry, which would try to launch another program. It also works on an album page's per-track menus,
   * which lack the "Go to album" entry.
   */
  function findCreditsItem(doc) {
    const items = [...doc.querySelectorAll("[role='menu'] [role='menuitem']")];
    const bare = items.find(
      (e, i) =>
        e.tagName === "BUTTON" &&
        !e.hasAttribute("aria-expanded") &&
        !e.hasAttribute("aria-disabled") &&
        items[i + 1]?.hasAttribute("aria-expanded"),
    );
    if (bare) return { el: bare, how: "bare-button-before-share" };
    const text = items.find((e) => /credit|autor|cr[eé]dit|mitwirk|クレジット/i.test(norm(e.textContent)));
    return text ? { el: text, how: "text" } : null;
  }

  /** The credits dialog: a native `<dialog aria-label>` (not role=dialog, which is the language/country pickers). */
  const findDialog = (doc) => doc.querySelector("dialog[open][aria-label]:has([role='group'], h1)");

  // ---- parsing ----

  /** Split "Composer • Lyricist" into its roles. */
  const splitRoles = (text) =>
    norm(text)
      .split(/\s*[•·]\s*/)
      .filter(Boolean);

  /**
   * Read the open credits dialog.
   * Structure: `<dialog aria-label>` > h1 (dialog title), h2 (track title), then sections. A section is a div whose
   * first child is a heading `<span>`, followed by `[role=group][aria-labelledby]` rows. A row has `span[dir=auto]`
   * (name) and `p[id^=listrow-subtitle-]` (roles). Artist rows are labelled by `...spotify:artist:<id>`.
   * "Sources" is a lone group at the top level with two plain spans (heading, value).
   * `section` is the heading text (localized) and `sectionIndex` its position, so a caller can use either.
   */
  function parseDialog(dialog) {
    const rows = [];
    const sections = [];
    let source = "";
    for (const group of dialog.querySelectorAll("[role='group'][aria-labelledby]")) {
      const nameEl = group.querySelector("span[dir='auto']");
      if (!nameEl) {
        // Sources: [heading, value, ...]. Anything else without a name is ignored rather than guessed at.
        const spans = [...group.querySelectorAll("span")].map((s) => norm(s.textContent));
        if (spans.length >= 2) source = spans.slice(1).join(", ");
        continue;
      }
      const container = group.parentElement;
      const first = container?.firstElementChild;
      const heading = first?.tagName === "SPAN" ? norm(first.textContent) : "";
      let sectionIndex = sections.indexOf(container);
      if (sectionIndex < 0) sectionIndex = sections.push(container) - 1;
      const label = group.getAttribute("aria-labelledby") ?? "";
      const artistId = /spotify:artist:([A-Za-z0-9]+)/.exec(label)?.[1] ?? null;
      const subtitle = group.querySelector("[id^='listrow-subtitle-']");
      rows.push({
        section: heading,
        sectionIndex,
        name: norm(nameEl.textContent),
        roles: splitRoles(subtitle?.textContent ?? ""),
        artistId,
      });
    }
    return {
      heading: norm(dialog.querySelector("h1")?.textContent),
      title: norm(dialog.querySelector("h2")?.textContent),
      sections: sections.map((s) => norm(s.firstElementChild?.textContent)),
      rows,
      source,
    };
  }

  /**
   * Header facts visible on the hydrated page. The release date is only a year here
   * (`[data-testid=release-date]`); the full date is in the `music:release_date` meta tag of the SERVER html (see
   * `readMeta` / `fetchMeta`), which the page removes when it hydrates.
   */
  function readHeader(doc) {
    const albumLink = doc.querySelector("[data-testid='entity-header'] a[href^='/album/']");
    return {
      title: norm(doc.querySelector("[data-testid='entityTitle']")?.textContent),
      artists: [...doc.querySelectorAll("[data-testid='entity-header'] [data-testid='creator-link']")].map((a) =>
        norm(a.textContent),
      ),
      albumId: /^\/album\/([A-Za-z0-9]+)/.exec(albumLink?.getAttribute("href") ?? "")?.[1] ?? null,
      year: norm(doc.querySelector("[data-testid='release-date']")?.textContent),
      cover: doc.querySelector("[data-testid='entity-header'] img[src*='scdn.co']")?.getAttribute("src") ?? null,
    };
  }

  /** The ℗/© lines of a track or album page, from `main` only (the footer carries "© <year> Spotify AB"). */
  function readCopyright(doc) {
    const out = { copyright: "", phonographic: "" };
    for (const p of doc.querySelectorAll("main p, main span")) {
      if (p.children.length > 0 || p.closest("[data-testid='footer-div'], footer")) continue;
      const text = norm(p.textContent);
      if (text.startsWith("℗") && !out.phonographic) out.phonographic = text;
      else if (text.startsWith("©") && !out.copyright) out.copyright = text;
    }
    return out;
  }

  /** Meta tags of a document: the server-rendered one (see `fetchMeta`) has them all, the hydrated one does not. */
  function readMeta(doc) {
    const get = (key) =>
      doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute("content")?.trim() ?? "";
    const description = get("og:description");
    return {
      title: get("og:title"),
      description,
      type: get("og:type"),
      releaseDate: get("music:release_date"),
      image: get("og:image"),
      albumUrl: get("music:album"),
      trackNumber: get("music:album:track"),
      durationSeconds: get("music:duration"),
      audioPreview: get("og:audio"),
      allowedCountries: doc.querySelectorAll('meta[property="og:restrictions:country:allowed"]').length,
    };
  }

  /** Fetch the same page without cookies and read the server-rendered meta tags (one extra GET to open.spotify.com). */
  async function fetchMeta(url, fetchImpl = fetch, parser = new DOMParser()) {
    const response = await fetchImpl(url, { credentials: "omit" });
    if (!response.ok) return { status: response.status };
    const text = await response.text();
    const parsed = parser.parseFromString(text, "text/html");
    return {
      status: response.status,
      length: text.length,
      metaTags: parsed.querySelectorAll("meta").length,
      ...readMeta(parsed),
    };
  }

  /** Text that appears on a bot wall; the page itself is left alone when it shows. */
  const isBlocked = (doc) =>
    /captcha|unusual traffic|access denied|too many requests/i.test((doc.body?.innerText ?? "").slice(0, 2000));

  // ---- making fixtures: no names, no ids ----

  /** Replace every occurrence of each key with its value in all attribute values below `root`, longest key first. */
  function replaceInAttributes(root, map) {
    const keys = [...map.keys()].sort((x, y) => y.length - x.length);
    for (const el of [root, ...root.querySelectorAll("*")]) {
      for (const attr of [...el.attributes]) {
        let value = attr.value;
        for (const key of keys) value = value.split(key).join(map.get(key));
        value = value.replace(/spotify:(artist|track|album):[A-Za-z0-9]+/g, "spotify:$1:SAMPLE");
        value = value.replace(/(\/(?:artist|track|album)\/)[A-Za-z0-9]{22}/g, "$1SAMPLE");
        if (/^(src|srcset)$/.test(attr.name)) value = "";
        if (value !== attr.value) el.setAttribute(attr.name, value);
      }
    }
  }

  /** Strip icon drawings so a fixture stays small. */
  function stripSvg(root) {
    for (const svg of root.querySelectorAll("svg")) svg.replaceChildren();
  }

  /**
   * A copy of the credits dialog's markup with people and the track replaced by placeholders ("Person 1", "Sample
   * Song", "Sample Label"), consistently in text and in the ids that embed names. Structure and every UI string
   * (headings, role names) are kept, since those are what a reader is tested against.
   */
  function sanitizeDialog(dialog) {
    const copy = dialog.cloneNode(true);
    const map = new Map();
    let people = 0;
    const person = (name) => {
      if (!map.has(name)) map.set(name, `Person ${String(++people)}`);
      return map.get(name);
    };
    const title = norm(copy.querySelector("h2")?.textContent);
    if (title) map.set(title, "Sample Song");
    for (const span of copy.querySelectorAll("span[dir='auto']")) span.textContent = person(norm(span.textContent));
    for (const group of copy.querySelectorAll("[role='group'][aria-labelledby]")) {
      if (group.querySelector("span[dir='auto']")) continue;
      const spans = group.querySelectorAll("span");
      const value = spans[spans.length - 1];
      if (spans.length >= 2 && value) value.textContent = "Sample Label";
    }
    const h2 = copy.querySelector("h2");
    if (h2) h2.textContent = "Sample Song";
    replaceInAttributes(copy, map);
    stripSvg(copy);
    return copy.outerHTML;
  }

  /** A copy of the open options menu with ids removed; the menu text is UI wording and is kept. */
  function sanitizeMenu(menu) {
    const copy = menu.cloneNode(true);
    replaceInAttributes(copy, new Map());
    stripSvg(copy);
    return copy.outerHTML;
  }

  /** The first `count` album rows with titles and artists replaced by placeholders. */
  function sanitizeRows(doc, count = 3) {
    const map = new Map();
    const out = [];
    for (const row of [...doc.querySelectorAll("[data-testid='tracklist-row']")].slice(0, count)) {
      const copy = row.cloneNode(true);
      const n = out.length + 1;
      const link = copy.querySelector("a[data-testid='internal-track-link']");
      const title = norm(link?.textContent);
      if (title) map.set(title, `Sample Track ${String(n)}`);
      for (const a of copy.querySelectorAll("a[href^='/artist/']")) {
        map.set(norm(a.textContent), "Artist One");
        a.textContent = "Artist One";
      }
      const titleEl = link?.querySelector("div");
      if (titleEl) titleEl.textContent = `Sample Track ${String(n)}`;
      replaceInAttributes(copy, map);
      stripSvg(copy);
      out.push(copy.outerHTML);
    }
    return out;
  }

  // ---- the read procedure ----

  /**
   * Open the dialog from an options button and read it. Never throws for page problems; `status` says what happened:
   *   ok            the dialog opened and has credit rows
   *   no-credits    the dialog opened but holds no credit rows (only a title, possibly a Sources entry)
   *   no-button     no options button appeared (page not hydrated, wrong page, track unavailable)
   *   no-menu       the button was clicked but no menu appeared
   *   no-item       a menu appeared but has no credits entry
   *   no-dialog     the entry was clicked but no dialog appeared
   *   blocked       a captcha / rate-limit text is showing
   * `steps` holds the milliseconds each stage took; a failed click is retried once (`attempt` says which one worked).
   */
  async function readCredits(
    doc,
    { button, timeoutMs = 10000, attempts = 2, capture = false, menuMs = 4000, dialogMs = 5000 } = {},
  ) {
    const steps = {};
    const t0 = Date.now();
    const mark = (name) => (steps[name] = Date.now() - t0);
    if (isBlocked(doc)) return { status: "blocked", steps };
    const more = button ?? (await until(() => findMoreButton(doc), timeoutMs));
    mark("button");
    if (!more) return { status: "no-button", steps };
    let last = { status: "no-menu" };
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) {
        // A click that did nothing (seen once on a cold first load): leave no menu behind, then try again.
        if (doc.querySelector("[role='menu']")) more.click();
        await until(() => !doc.querySelector("[role='menu']"), 1500);
        await sleep(500);
      }
      more.click();
      const item = await until(() => findCreditsItem(doc), menuMs);
      mark("menu" + String(attempt));
      const menu = [...doc.querySelectorAll("[role='menu'] [role='menuitem']")].map((e) => norm(e.textContent));
      if (!item) {
        last = { status: menu.length > 0 ? "no-item" : "no-menu", menu };
        continue;
      }
      const menuHtml = capture ? sanitizeMenu(item.el.closest("[role='menu']")) : undefined;
      item.el.click();
      const dialog = await until(() => findDialog(doc), dialogMs);
      mark("dialog" + String(attempt));
      if (!dialog) {
        last = { status: "no-dialog", menu, how: item.how };
        continue;
      }
      // The rows are rendered together with the dialog; a short settle covers a late second render.
      await sleep(150);
      const parsed = parseDialog(dialog);
      mark("parsed");
      const html = capture ? { menuHtml, dialogHtml: sanitizeDialog(dialog) } : {};
      return {
        status: parsed.rows.length > 0 ? "ok" : "no-credits",
        attempt,
        steps,
        menu,
        how: item.how,
        ...parsed,
        ...html,
      };
    }
    if (doc.querySelector("[role='menu']")) more.click();
    return { ...last, attempt: attempts, steps };
  }

  /** Close the dialog (the close button is the only `button[aria-label]` directly in its header) and wait for it. */
  async function closeDialog(doc) {
    const dialog = findDialog(doc);
    if (!dialog) return true;
    dialog.querySelector("button[aria-label]")?.click();
    return !!(await until(() => !findDialog(doc), 2000));
  }

  return {
    norm,
    until,
    findMoreButton,
    trackRows,
    readAlbumTracks,
    readAlbumTrackCount,
    findCreditsItem,
    findDialog,
    parseDialog,
    sanitizeDialog,
    sanitizeMenu,
    sanitizeRows,
    readHeader,
    readCopyright,
    readMeta,
    fetchMeta,
    isBlocked,
    readCredits,
    closeDialog,
  };
}

/** Source text of the reader, for injection: evaluates to the reader object. */
export const readerSource = `(${spotifyReader.toString()})()`;

/** Page URL for a track or album, forcing English so the section headings and role names are the ones documented. */
export const spotifyUrl = (kind, id, { intl = "en" } = {}) =>
  `https://open.spotify.com/${intl ? `intl-${intl}/` : ""}${kind}/${id}`;
