// Opt-in live check of "this song on Apple Music and Spotify": on real Genius song pages, the panel lists the song's
// Apple Music and Spotify pages. It sends real traffic (a few Genius pages, iTunes and Spotify look-ups, and one
// hidden Spotify search tab per song without a Spotify id), one page at a time and 15 seconds apart, so run it
// sparingly and never in a loop.
//
//   npm run build
//   node scripts/live-matches.mjs --chrome <chrome.exe> [--screenshots <folder>] [--only <case>] [--get-credits] [--headless]
//   node scripts/live-matches.mjs --chrome <chrome.exe> --albums [--screenshots <folder>] [--only <case>]
//
// --albums runs the same check on real Genius album pages instead (one iTunes search and one hidden Spotify albums
// search tab per album) and tells, for every service, whether the page found is the expected album: found / correct /
// none / wrong. A wrong match fails the run; "none" never does, because a missed album is better than a wrong one.
//
// --aliases runs real Genius song pages whose artist names carry a real name in a parenthetical ("mike. (Mike Stud)"),
// a disambiguation suffix ("bôa (UK)") or stylised punctuation ("P!nk"), and tells for every service whether the page
// found is the expected song (found / correct / none / wrong); a wrong match fails the run, "none" never does.
//
// --varied runs everyday songs of every shape (one or several artists, featured, accents, non-Latin scripts, symbols)
// and tells for every service whether the song found is the expected one.
//
// --get-credits also presses Get credits on the Apple Music row of the Fortnight case and checks that the review
// opens; it leaves the panel on the review screen, so use it with --only apple-id-only.
// The browser starts minimized. (--headless runs it with no window at all, but Genius shows a human check to a
// headless browser, so its pages cannot be read that way; that check is not something to get around.) The panel is opened as a page of its own
// and the Genius tab is brought to the front, so the panel sees the Genius tab as the one the user is on. Nothing is
// typed into Genius and nothing is saved.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findServiceWorker, launchChromium, sleep, waitUntilReady } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const shotsDir = option("--screenshots", "");
const headless = args.includes("--headless");
const getCredits = args.includes("--get-credits");
const manual = args.includes("--manual");
if (!chromePath) throw new Error("Pass --chrome <path to a Chromium or Chrome executable> (or set CHROME_PATH).");

const GAP_MS = 15_000;
const CASES = [
  { name: "both-ids", url: "https://genius.com/Olivia-rodrigo-good-4-u-lyrics", expect: "ready" },
  { name: "apple-id-only", url: "https://genius.com/Taylor-swift-fortnight-lyrics", expect: "ready" },
  { name: "retired-apple-id", url: "https://genius.com/Dua-lipa-houdini-lyrics", expect: "ready" },
  { name: "no-spotify-match", url: "https://genius.com/Garth-brooks-friends-in-low-places-lyrics", expect: "ready" },
  { name: "not-a-song", url: "https://genius.com/artists/Taylor-swift", expect: "none" },
];

// Real Genius album pages. `names` lists how the album may be named in the panel ("Artist - Title", as either service
// spells it): a page found under any other name is counted as WRONG until looked at by hand. `none` marks a service that
// is expected to have no exact match (the check then only fails when something wrong is found).
const ALBUM_CASES = [
  { name: "album-sour", url: "https://genius.com/albums/Olivia-rodrigo/Sour", names: ["Olivia Rodrigo - SOUR"] },
  { name: "album-gnx", url: "https://genius.com/albums/Kendrick-lamar/Gnx", names: ["Kendrick Lamar - GNX"] },
  {
    name: "album-ep",
    url: "https://genius.com/albums/Billie-eilish/Dont-smile-at-me",
    names: ["Billie Eilish - dont smile at me", "Billie Eilish - dont smile at me - EP"],
  },
  {
    name: "album-single",
    url: "https://genius.com/albums/Sabrina-carpenter/Espresso",
    names: ["Sabrina Carpenter - Espresso", "Sabrina Carpenter - Espresso - Single"],
  },
  {
    name: "album-compilation",
    url: "https://genius.com/albums/Michael-jackson/The-essential-michael-jackson",
    names: ["Michael Jackson - The Essential Michael Jackson"],
  },
  {
    name: "album-various-artists",
    url: "https://genius.com/albums/Various-artists/Guardians-of-the-galaxy-awesome-mix-vol-1-original-motion-picture-soundtrack",
    names: ["Various Artists - Guardians of the Galaxy: Awesome Mix, Vol. 1 (Original Motion Picture Soundtrack)"],
  },
  {
    name: "album-diacritics",
    url: "https://genius.com/albums/Bad-bunny/Nadie-sabe-lo-que-va-a-pasar-manana",
    names: ["Bad Bunny - nadie sabe lo que va a pasar mañana"],
  },
  {
    name: "album-deluxe",
    url: "https://genius.com/albums/Ed-sheeran/Divide-deluxe-edition",
    names: ["Ed Sheeran - ÷ (Divide) [Deluxe Edition]", "Ed Sheeran - ÷ (Deluxe Edition)", "Ed Sheeran - ÷ (Deluxe)"],
  },
  { name: "album-japanese", url: "https://genius.com/albums/Yoasobi/The-book", names: ["YOASOBI - THE BOOK"] },
  { name: "album-accented-artist", url: "https://genius.com/albums/Rosalia/Motomami", names: ["ROSALÍA - MOTOMAMI"] },
  {
    name: "album-edition",
    url: "https://genius.com/albums/Taylor-swift/The-tortured-poets-department-the-anthology",
    names: ["Taylor Swift - THE TORTURED POETS DEPARTMENT: THE ANTHOLOGY"],
  },
  {
    name: "album-comma-in-artist",
    url: "https://genius.com/albums/Tyler-the-creator/Flower-boy",
    names: ["Tyler, The Creator - Flower Boy"],
  },
  {
    name: "album-versioned",
    url: "https://genius.com/albums/Taylor-swift/1989-taylors-version-deluxe",
    names: ["Taylor Swift - 1989 (Taylor’s Version) [Deluxe]", "Taylor Swift - 1989 (Taylor's Version) [Deluxe]"],
  },
  {
    name: "album-translation",
    url: "https://genius.com/albums/Genius-traducciones-al-espanol/Olivia-rodrigo-sour-traduccion-al-espanol",
    expect: "none",
  },
];
// Songs whose artist names are written in a way the services are not. `accepts` tells whether a found "Artist - Title"
// is the right song; a service that finds nothing is counted as none (right for a disambiguated name).
const folded = (text) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const song = (artist, title) => (name) => folded(name).includes(folded(artist)) && folded(name).includes(folded(title));
const ALIAS_CASES = [
  { name: "alias-ghost", url: "https://genius.com/Mike-mike-stud-ghost-lyrics", accepts: song("mike.", "ghost") },
  {
    name: "alias-these-days",
    url: "https://genius.com/Mike-mike-stud-these-days-lyrics",
    accepts: song("mike.", "These Days"),
  },
  { name: "alias-swish", url: "https://genius.com/Mike-mike-stud-swish-lyrics", accepts: song("mike.", "Swish") },
  {
    name: "alias-featured",
    url: "https://genius.com/Bea-miller-to-the-grave-lyrics",
    accepts: song("Bea Miller", "to the grave"),
  },
  { name: "suffix-uk", url: "https://genius.com/Boa-uk-duvet-lyrics", accepts: song("bôa", "Duvet") },
  {
    name: "suffix-uk-band",
    url: "https://genius.com/The-prodigy-uk-firestarter-lyrics",
    accepts: song("The Prodigy", "Firestarter"),
  },
  {
    name: "translit",
    url: "https://genius.com/Evse-and-floki-rus-stealing-alcohol-lyrics",
    accepts: song("EVSE", "Ворую алкоголь (Stealing Alcohol)"),
  },
  { name: "punct-pink", url: "https://genius.com/P-nk-what-about-us-lyrics", accepts: song("P!nk", "What About Us") },
  {
    name: "punct-suicideboys",
    url: "https://genius.com/Uicideboy-paris-lyrics",
    accepts: song("$uicideboy$", "Paris"),
  },
  { name: "punct-kesha", url: "https://genius.com/Kesha-tik-tok-lyrics", accepts: song("Kesha", "TiK ToK") },
  {
    name: "feat-gorillaz",
    url: "https://genius.com/Gorillaz-momentary-bliss-lyrics",
    accepts: song("Gorillaz", "Momentary Bliss"),
  },
];
// Everyday songs of every shape: one artist, several primary artists, featured artists, accents, non-Latin scripts,
// digits and symbols in names. Run with --varied; a page that is not a Genius song (a wrong slug) fails "card settled".
const VARIED_CASES = [
  {
    name: "russian-1",
    url: "https://genius.com/Max-korzh-live-dope-lyrics",
    accepts: (n) => ["Макс Корж", "Max Korzh"].some((a) => ["Жить в кайф", "Live Dope"].some((t) => song(a, t)(n))),
  },
  {
    name: "russian-2",
    url: "https://genius.com/Kino-blood-type-lyrics",
    accepts: (n) => ["КИНО", "Kino"].some((a) => ["Группа крови", "Blood Type"].some((t) => song(a, t)(n))),
  },
  {
    name: "russian-3",
    url: "https://genius.com/Zemfira-i-was-looking-lyrics",
    accepts: (n) => ["Земфира", "Zemfira"].some((a) => ["Искала", "Iskala"].some((t) => song(a, t)(n))),
  },
  {
    name: "russian-4",
    url: "https://genius.com/Basta-samsara-lyrics",
    accepts: (n) => ["Баста", "Basta"].some((a) => ["Сансара", "Samsara"].some((t) => song(a, t)(n))),
  },
  {
    name: "russian-5",
    url: "https://genius.com/Skryptonite-position-lyrics",
    accepts: (n) => ["Скриптонит", "Skryptonite"].some((a) => ["Положение", "Position"].some((t) => song(a, t)(n))),
  },
  {
    name: "russian-translation",
    url: "https://genius.com/Genius-english-translations-max-korzh-live-dope-english-translation-lyrics",
    accepts: () => false,
  },
  {
    name: "one-artist",
    url: "https://genius.com/Taylor-swift-blank-space-lyrics",
    accepts: song("Taylor Swift", "Blank Space"),
  },
  {
    name: "one-artist-2",
    url: "https://genius.com/Ed-sheeran-shape-of-you-lyrics",
    accepts: song("Ed Sheeran", "Shape of You"),
  },
  {
    name: "two-primary",
    url: "https://genius.com/Lady-gaga-and-bruno-mars-die-with-a-smile-lyrics",
    accepts: song("Lady Gaga", "Die With A Smile"),
  },
  { name: "two-primary-2", url: "https://genius.com/Cardi-b-wap-lyrics", accepts: song("Cardi B", "WAP") },
  {
    name: "featured",
    url: "https://genius.com/Travis-scott-sicko-mode-lyrics",
    accepts: song("Travis Scott", "SICKO MODE"),
  },
  {
    name: "featured-2",
    url: "https://genius.com/Post-malone-congratulations-lyrics",
    accepts: song("Post Malone", "Congratulations"),
  },
  {
    name: "japanese",
    url: "https://genius.com/Yoasobi-idol-lyrics",
    accepts: (n) => ["YOASOBI", "YOASOBI"].some((a) => ["Idol", "アイドル"].some((t) => song(a, t)(n))),
  },
  {
    name: "japanese-title",
    url: "https://genius.com/Yoasobi-yoru-ni-kakeru-lyrics",
    accepts: (n) => ["YOASOBI", "YOASOBI"].some((a) => ["Yoru ni kakeru", "夜に駆ける"].some((t) => song(a, t)(n))),
  },
  { name: "korean", url: "https://genius.com/Bts-dynamite-lyrics", accepts: song("BTS", "Dynamite") },
  {
    name: "korean-2",
    url: "https://genius.com/Blackpink-how-you-like-that-lyrics",
    accepts: song("BLACKPINK", "How You Like That"),
  },
  { name: "accent-artist", url: "https://genius.com/Rosalia-despecha-lyrics", accepts: song("Rosalia", "DESPECHÁ") },
  {
    name: "accent-title",
    url: "https://genius.com/Bad-bunny-titi-me-pregunto-lyrics",
    accepts: song("Bad Bunny", "Tití Me Preguntó"),
  },
  { name: "accent-beyonce", url: "https://genius.com/Beyonce-halo-lyrics", accepts: song("Beyoncé", "Halo") },
  { name: "digit-artist", url: "https://genius.com/21-savage-a-lot-lyrics", accepts: song("21 Savage", "a lot") },
  {
    name: "slash-artist",
    url: "https://genius.com/Ac-dc-back-in-black-lyrics",
    accepts: song("AC/DC", "Back In Black"),
  },
  {
    name: "ampersand-artist",
    url: "https://genius.com/Simon-and-garfunkel-the-sound-of-silence-lyrics",
    accepts: song("Simon & Garfunkel", "Sound"),
  },
  {
    name: "and-artist",
    url: "https://genius.com/Earth-wind-and-fire-september-lyrics",
    accepts: song("Earth, Wind & Fire", "September"),
  },
  {
    name: "comma-artist",
    url: "https://genius.com/Tyler-the-creator-earfquake-lyrics",
    accepts: song("Tyler, The Creator", "EARFQUAKE"),
  },
  { name: "german", url: "https://genius.com/Rammstein-du-hast-lyrics", accepts: song("Rammstein", "Du Hast") },
  {
    name: "one-artist-3",
    url: "https://genius.com/Hozier-take-me-to-church-lyrics",
    accepts: song("Hozier", "Take Me To Church"),
  },
];
const russian = args.includes("--russian");
const varied = args.includes("--varied") || russian;
const aliases = args.includes("--aliases");
const albums = args.includes("--albums");
const tally = {
  apple: { found: 0, correct: 0, none: 0, wrong: 0, failed: 0 },
  spotify: { found: 0, correct: 0, none: 0, wrong: 0, failed: 0 },
};

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

const browser = launchChromium({
  chromePath,
  dist: join(root, "dist"),
  port: 9337,
  extraArgs: headless ? ["--headless=new", "--window-size=420,900"] : ["--start-minimized"],
});
let worker;
let panel;
try {
  const workerTarget = await findServiceWorker(browser);
  worker = await connect(workerTarget.webSocketDebuggerUrl);
  await waitUntilReady(worker);
  await worker.evaluate(
    `chrome.storage.sync.set({ settings: { onboarded: true, findPagesOnGenius: ${String(!manual)} } })`,
  );
  const extensionId = new URL(workerTarget.url).host;
  const panelUrl = `chrome-extension://${extensionId}/ui/panel.html`;

  // The panel as a page of its own; it is a background tab while a Genius tab is in front.
  await browser.openTab(panelUrl);
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    target = (await browser.targets()).find((t) => t.url.startsWith(panelUrl) && t.type === "page");
    if (!target) await sleep(200);
  }
  if (!target) throw new Error("The panel page did not open.");
  panel = await connect(target.webSocketDebuggerUrl);
  await panel.send("Emulation.setDeviceMetricsOverride", {
    width: 400,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const text = (selector) => panel.evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? null`);
  const exists = (selector) => panel.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
  const shot = async (name) => {
    if (!shotsDir) return;
    mkdirSync(shotsDir, { recursive: true });
    const { data } = await panel.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, "base64"));
  };
  const until = async (expression, ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await panel.evaluate(expression).catch(() => false)) return true;
      await sleep(250);
    }
    return false;
  };

  const tabIdOf = (url) =>
    worker.evaluate(
      `chrome.tabs.query({}).then((tabs) => tabs.find((t) => (t.url || '').startsWith(${JSON.stringify(url)}))?.id ?? null)`,
    );

  let first = true;
  const only = option("--only", "");
  for (const c of (albums
    ? ALBUM_CASES
    : varied
      ? VARIED_CASES.filter((c) => !russian || c.name.startsWith("russian"))
      : aliases
        ? ALIAS_CASES
        : CASES
  ).filter((c) => !only || c.name === only)) {
    if (!first) await sleep(GAP_MS);
    first = false;
    await browser.openTab(c.url);
    let tabId = null;
    for (let i = 0; i < 50 && tabId === null; i++) {
      tabId = await tabIdOf(c.url);
      if (tabId === null) await sleep(200);
    }
    check(`${c.name}: the Genius page opened`, tabId !== null);
    if (tabId === null) continue;
    await worker.evaluate(`chrome.tabs.update(${String(tabId)}, { active: true }).then(() => true)`);

    if (c.expect === "ready" || c.names || c.accepts) {
      if (manual) {
        // Nothing may be looked up before the button: the card shows only the button, then it is pressed.
        const idle = await until("!!document.querySelector('[data-key=\"song-matches-find\"]')", 20_000);
        check(`${c.name}: the card waits with a button`, idle);
        await shot(`${c.name}-button`);
        await panel.evaluate("document.querySelector('[data-key=\"song-matches-find\"]').click()");
      }
      // Done once the card has stopped looking: its Looking title is gone.
      const settled = await until(
        "(() => { const h = document.querySelector('[data-key=\"song-matches\"] h3'); return !!h && !h.textContent.startsWith('Looking'); })()",
        90_000,
      );
      check(`${c.name}: the card settled`, settled);
      await sleep(500);
      console.log(`      ${String(await text('[data-key="song-matches"]')).replace(/\s+/g, " ")}`);
      check(`${c.name}: the Apple Music row shows`, await exists('[data-key^="match-apple"]'));
      check(`${c.name}: the Spotify row shows`, await exists('[data-key^="match-spotify"]'));
      if (c.names || c.accepts) {
        for (const service of ["apple", "spotify"]) {
          // Each found album is a button of its own ("several" gives more than one); a note row means none or failed.
          const found = JSON.parse(
            await panel.evaluate(
              `JSON.stringify([...document.querySelectorAll('button[data-key^="match-${service}"] .open-name')].map((n) => n.textContent.trim()))`,
            ),
          );
          const note = await text(`li.match-note[data-key^="match-${service}"]`);
          if (found.length === 0) {
            tally[service][String(note).includes("Could not") ? "failed" : "none"]++;
            console.log(`      ${service}: ${String(note).replace(/\s+/g, " ")}`);
          }
          for (const name of found) {
            tally[service].found++;
            const right = c.accepts ? c.accepts(name) : c.names.some((n) => n.toLowerCase() === name.toLowerCase());
            tally[service][right ? "correct" : "wrong"]++;
            console.log(`      ${service}: ${name}${right ? "" : "   <-- NOT the expected name: check by hand"}`);
            check(`${c.name}: ${service} found the expected ${c.accepts ? "song" : "album"}`, right, name);
          }
        }
      }
    } else {
      // Give the panel time to ask, then it must show nothing (an artist page, a translation of an album).
      if (manual && c.name === "album-translation") {
        // Button-first mode asks nothing until Find is pressed; the page then says it is no album.
        await until("!!document.querySelector('[data-key=\"song-matches-find\"]')", 20_000);
        await panel.evaluate("document.querySelector('[data-key=\"song-matches-find\"]')?.click()");
      }
      await sleep(8000);
      check(`${c.name}: no card`, !(await exists('[data-key="song-matches"]')));
    }
    await shot(c.name);

    if (getCredits && c.name === "apple-id-only") {
      await panel.evaluate("document.querySelector('button[data-key=\"match-apple\"]')?.click()");
      // A single song goes straight on: the review shows its credits and Start pasting.
      const read = await until("document.body.innerText.includes('Start pasting')", 90_000);
      console.log(
        `      after Get credits: ${String(await text("#screen"))
          .replace(/\s+/g, " ")
          .slice(0, 300)}`,
      );
      check(`${c.name}: Get credits went on to the review`, read);
      await shot(`${c.name}-credits`);
    }
    await worker.evaluate(`chrome.tabs.remove(${String(tabId)}).then(() => true)`);
  }
} finally {
  panel?.close();
  worker?.close();
  await browser.stop();
}

if (albums) console.log("\nAlbum look-ups:", JSON.stringify(tally));
console.log(failures.length === 0 ? "\nAll checks passed." : `\n${String(failures.length)} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
