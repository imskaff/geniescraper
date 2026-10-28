// Opt-in live check of the Genius fill through the real extension: the side panel, the service worker, the content
// script and a real F8 key press, against live Apple Music and a live, signed-in Genius edit form.
//
//   npm run build
//   node scripts/live-genius.mjs --chrome <chrome.exe> --profile <folder with a Genius sign-in> [--screenshots <folder>]
//        [--mode manual|auto] [--song <the edit page of a song you created>]
//
// --mode manual (the default) starts "Step by step" and presses a real F8 for every field.
// --mode auto starts Start pasting, lets the run fill the form by itself, and on the way checks that it stops and
// resumes for Pause, Esc, a real click in the form and the panel closing. Leave the mouse and keyboard alone while it
// runs: a real click in the Genius window pauses an automatic run, which is the point of the check.
//
// You sign in to Genius yourself, once, in a Chromium window that uses that profile folder; this script never
// handles a password. It NEVER presses Save: it only fills the open form, watches the network for anything that
// could be a save, and discards the form by reloading the page at the end.
//
// The page used is a song you created (edit it freely); change SONG_URL to one of yours if you run this yourself.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findServiceWorker, launchChromium, sleep, waitUntilReady } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const profileDir = option("--profile", "");
const shotsDir = option("--screenshots", "");
if (!chromePath || !profileDir)
  throw new Error("Pass --chrome <path to Chromium> and --profile <signed-in profile folder>.");

// "manual" presses a real F8 per field; "auto" starts the automatic run and checks every way it must stop and resume.
const mode = option("--mode", "manual");
if (mode !== "manual" && mode !== "auto") throw new Error('--mode must be "manual" or "auto".');

const SONG_URL = option("--song", "https://genius.com/Insane-shinobi-and-mike-pratt-float-indigo-lyrics");
const ALBUM_URL = "https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134";
const TRACK_INDEX = 2; // zero-based: CHIHIRO
const MAX_PRESSES = 120;

const golden = JSON.parse(readFileSync(join(root, "..", "tests", "golden", "eilish-hmhas-t3.json"), "utf-8"));

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

const words = (text) =>
  (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).join(" ");

// A profile that has run this extension before keeps its service worker script cached under the same version, so a
// rebuilt extension can silently run the old worker. A throwaway copy of the build with a version of its own forces a
// fresh one, and nothing in the profile has to be deleted.
const loaded = join(mkdtempSync(join(tmpdir(), "geniescraper-live-dist-")), "dist");
cpSync(join(root, "dist"), loaded, { recursive: true });
const manifestFile = join(loaded, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
manifest.version = `${String(manifest.version).split(".").slice(0, 3).join(".")}.${String(Math.floor(Date.now() / 60000) % 65535)}`;
writeFileSync(manifestFile, JSON.stringify(manifest));

const browser = launchChromium({ chromePath, dist: loaded, port: 9337, profileDir });
let worker;
let panel;
let genius;
try {
  const workerTarget = await findServiceWorker(browser);
  worker = await connect(workerTarget.webSocketDebuggerUrl);
  await waitUntilReady(worker);
  // The first-time set-up is not what this check is about: mark it as done.
  await worker.evaluate("chrome.storage.sync.set({ settings: { onboarded: true } })");
  const panelUrl = `chrome-extension://${new URL(workerTarget.url).host}/ui/panel.html`;

  // ── Genius: the user's own song, with the edit form open ──
  const geniusTab = await browser.openTab(SONG_URL);
  genius = await connect(geniusTab.webSocketDebuggerUrl);
  await genius.send("Page.bringToFront");
  const gEval = (expression) => genius.evaluate(expression);
  const gUntil = async (expression, what, ms = 20000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await gEval(expression).catch(() => false)) return true;
      await sleep(250);
    }
    check(`waited for ${what}`, false, "timed out");
    return false;
  };

  await gUntil("!!document.querySelector('button')", "the Genius page");
  const hasEdit = await gUntil(
    "[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Edit Metadata')",
    "the Edit Metadata button",
    15000,
  );
  check("signed in to Genius (the Edit Metadata button is there)", hasEdit);
  if (!hasEdit)
    throw new Error(`Not signed in to Genius in profile ${profileDir}. Sign in once, close the window, run again.`);

  // Record any request that could be a save (anything but a GET to Genius's own API), from now on.
  await gEval(`(() => {
    window.__geniescraperWrites = [];
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const url = String((input && input.url) || input);
      if (method !== 'GET' && /genius\\.com\\/api\\//.test(new URL(url, location.href).href)) window.__geniescraperWrites.push(method + ' ' + url);
      return originalFetch.apply(this, arguments);
    };
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      if (String(method).toUpperCase() !== 'GET' && /genius\\.com\\/api\\//.test(new URL(String(url), location.href).href)) window.__geniescraperWrites.push(String(method).toUpperCase() + ' ' + url);
      return open.apply(this, arguments);
    };
  })()`);

  await gEval("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit Metadata').click()");
  await gUntil("!!document.querySelector('form[aria-label=\"Edit Song Metadata Form\"]')", "the edit form");
  check("the edit form is open", true);

  // A real song already has credits; they are not the run's doing, so note them before it starts.
  const before = await gEval(`(() => {
    const form = document.querySelector('form[aria-label="Edit Song Metadata Form"]');
    const chips = (box) => [...box.querySelectorAll('[class*="multiValue"]')].map((c) => c.textContent.trim());
    const field = (label) => [...form.querySelectorAll('label')].find((l) => (l.querySelector('span')?.textContent || '').replace(/\\s+/g, ' ').replace(/\\*$/, '').trim() === label);
    const note = document.querySelector('[data-testid="custom-performances-expander"]')?.parentElement?.querySelector('p');
    return {
      writer: chips(field('Writer')),
      producer: chips(field('Producer')),
      roles: Number(note?.textContent.match(/\\d+/)?.[0] ?? 0),
    };
  })()`);
  console.log(
    `      already on the song: ${String(before.writer.length)} writers, ${String(before.producer.length)} producers, ${String(before.roles)} additional roles`,
  );

  // ── the panel, in its own window so the Genius tab stays the one in front of the user ──
  let panelWindowId = 0;
  const openPanel = async () => {
    panelWindowId = await worker.evaluate(
      `chrome.windows.create({ url: ${JSON.stringify(panelUrl)}, focused: false, width: 440, height: 860 }).then((w) => w.id)`,
    );
    let panelTarget;
    for (let i = 0; i < 100 && !panelTarget; i++) {
      panelTarget = (await browser.targets()).find((t) => t.url === panelUrl && t.type === "page");
      if (!panelTarget) await sleep(200);
    }
    panel = await connect(panelTarget.webSocketDebuggerUrl);
  };
  await openPanel();
  const pText = (selector) =>
    panel.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const pUntil = async (expression, what, ms = 60000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await panel.evaluate(expression).catch(() => false)) return true;
      await sleep(250);
    }
    check(`waited for ${what}`, false, "timed out");
    return false;
  };
  const pClick = (label) =>
    panel.evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click()`,
    );
  const shot = async (target, name) => {
    if (!shotsDir) return;
    mkdirSync(shotsDir, { recursive: true });
    const { data } = await target.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, "base64"));
  };

  await pUntil("!!document.querySelector('#link')", "the panel");
  await panel.evaluate(`(() => {
    const input = document.querySelector('#link');
    input.value = ${JSON.stringify(ALBUM_URL)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`);
  await pUntil("document.querySelector('h2')?.textContent === 'HIT ME HARD AND SOFT'", "the track list");
  await pClick("Select none");
  await panel.evaluate(`document.querySelector('[data-key="track-${String(TRACK_INDEX)}"]').click()`);
  await pClick("Get credits for 1 track");
  await pUntil(
    "[...document.querySelectorAll('button')].some((b) => b.textContent === 'Start pasting')",
    "the credits",
  );
  // Start pasting runs by itself; Step by step is the one-press-per-field flow the manual mode checks.
  await pClick(mode === "auto" ? "Start pasting" : "Step by step");
  await pUntil("document.querySelector('h2')?.textContent === 'Paste into Genius'", "the paste screen");
  check("the paste screen opens", (await pText("h2")) === "Paste into Genius");
  const total = Number(((await pText(".progress")) ?? "").match(/of (\d+)/)?.[1] ?? 0);
  check("the queue has steps", total > 10, String(total));
  await shot(panel, "genius-1-paste-screen");

  // ── a real F8, one field per press ──
  const press = async (key, code, vk) => {
    for (const type of ["keyDown", "keyUp"]) {
      await genius.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk });
    }
  };
  const position = async () => {
    if ((await pText("h2")) === "All credits entered") return total; // the finished screen replaces the step counter
    const text = (await pText(".progress")) ?? "";
    return text === "All steps done" ? total : Number(text.match(/Step (\d+) of/)?.[1] ?? 0) - 1;
  };

  const skipped = [];
  const problems = [];
  const filled = [];
  let presses = 0;

  // ── an automatic run, and every way it must stop and start again ──
  const pHas = (selector) => panel.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
  const isPaused = () => pHas('[data-key="auto-resume"]');
  const stateInStorage = () =>
    worker.evaluate("chrome.storage.session.get('paste').then((items) => items.paste ?? null)");
  const pausedWithin = async (ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await isPaused().catch(() => false)) return true;
      await sleep(150);
    }
    return false;
  };
  /** Run until the position has moved `by` steps (or the track is done); a step needing the user's choice is skipped. */
  const runFor = async (by, limitMs = 90000) => {
    const start = await position();
    const deadline = Date.now() + limitMs;
    while (Date.now() < deadline) {
      const now = await position();
      if (now >= total || now >= start + by) return true;
      if (await isPaused().catch(() => false)) {
        const problem = (await pText("#alert")) ?? "";
        if (!problem) return false;
        // A paused run with a problem message: record it, skip that step, and carry on, so the rest is still checked.
        problems.push(`${(await pText(".step .value")) ?? ""}: ${problem}`);
        await pClick("Skip");
        await resume();
        continue;
      }
      if (((await pText("#alert")) ?? "").length > 0 || ((await pText(".step + p")) ?? "").includes("Choose ")) {
        // Genius had no exact match: the run waits for the user, who here skips the field.
        skipped.push((await pText(".step .value")) ?? "");
        await pClick("Skip");
        await sleep(400);
      }
      await sleep(300);
    }
    return false;
  };
  const resume = async () => {
    await pClick("Resume");
    await pUntil("!!document.querySelector('[data-key=\"auto-pause\"]')", "the run to be going again", 15000);
  };
  const runAuto = async () => {
    const started = await pUntil("!!document.querySelector('[data-key=\"auto-pause\"]')", "Pause", 20000);
    check("the run starts by itself, with Pause on screen", started);
    if (!started) {
      // Say what the panel and the worker hold, so a failure here can be understood without another run.
      const text = await panel.evaluate("document.querySelector('main')?.innerText ?? document.body.innerText");
      const held = await stateInStorage();
      console.log(`      panel says: ${String(text).replace(/\s+/g, " ").slice(0, 700)}`);
      console.log(
        `      worker holds: ${JSON.stringify({ active: held?.active, auto: held?.auto, reason: held?.pauseReason, position: held?.position, awaiting: held?.awaiting, busy: held?.busy, message: held?.message })}`,
      );
      await shot(panel, "genius-auto-0-not-started");
      throw new Error("the automatic run did not start");
    }
    check("it fills fields without a key press", await runFor(3));
    await shot(panel, "genius-auto-1-running");

    // Pause, from the panel: it stops after the step in progress and stays stopped.
    await pClick("Pause");
    check("Pause pauses the run", await pausedWithin(15000));
    await sleep(1500);
    const held = await position();
    await sleep(3000);
    check("a paused run fills nothing more", (await position()) === held, String(held));
    await resume();
    check("Resume carries on", await runFor(1));

    // Esc, a real key press in the Genius window.
    await genius.send("Page.bringToFront");
    await press("Escape", "Escape", 27);
    check("Esc pauses the run", await pausedWithin(10000));
    await resume();
    check("it carries on after Esc", await runFor(1));

    // A real click in the form: the page sees a trusted event and pauses the run.
    const point = await gEval(`(() => {
      const r = document.querySelector('form[aria-label="Edit Song Metadata Form"]').getBoundingClientRect();
      return { x: Math.round(r.left + 6), y: Math.round(Math.max(r.top, 0) + 6) };
    })()`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await genius.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
    }
    const clickPaused = await pausedWithin(10000);
    check("a real click in the form pauses the run", clickPaused);
    if (clickPaused) {
      check(
        "it says it paused because of the form",
        ((await pText("#status")) ?? "").includes("used the form"),
        (await pText("#status")) ?? "",
      );
      await resume();
    }
    check("it carries on after the click", await runFor(1));

    // The panel closing: the worker pauses the run, since nobody is watching it.
    await panel.send("Page.close").catch(() => undefined);
    await worker.evaluate(`chrome.windows.remove(${String(panelWindowId)})`).catch(() => undefined);
    let stored = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      stored = await stateInStorage();
      if (stored?.auto === "paused") break;
    }
    check(
      "closing the panel pauses the run",
      stored?.auto === "paused" && stored?.pauseReason === "panel-closed",
      JSON.stringify({ auto: stored?.auto, reason: stored?.pauseReason }),
    );
    const heldClosed = stored?.position;
    await sleep(3000);
    check("nothing is filled while the panel is closed", (await stateInStorage())?.position === heldClosed);

    // Open the panel again: the session is restored, paused, and Resume finishes the track.
    await openPanel();
    await pUntil("!!document.querySelector('[data-key=\"auto-resume\"]')", "the restored paste screen", 20000);
    check("the reopened panel shows the paused run", await isPaused());
    await resume();
    check("it finishes the track by itself", await runFor(total, 180000));
  };

  if (mode === "auto") await runAuto();
  for (; mode === "manual" && presses < MAX_PRESSES; presses++) {
    const before = await position();
    if (before >= total) break;
    const step = (await pText(".step .value")) ?? "";
    await press("F8", "F8", 119);
    // The step finishes when the position moves, or the worker asks the user to choose.
    let moved = false;
    for (let i = 0; i < 80 && !moved; i++) {
      await sleep(250);
      moved = (await position()) !== before || ((await pText("#alert")) ?? "").length > 0;
    }
    if (((await pText("#alert")) ?? "").length > 0) {
      skipped.push(step);
      await pClick("Skip");
      await sleep(300);
    } else {
      filled.push(step);
    }
  }
  check("every step was handled", (await position()) >= total, `${String(presses)} presses`);
  console.log(
    `      filled ${String(filled.length)}, left for the user ${String(skipped.length)}: ${skipped.join(" | ")}`,
  );
  check("no step stopped the run as a problem", problems.length === 0, problems.join(" | "));
  check("the panel ends on All steps done", (await position()) >= total);
  await shot(genius, "genius-2-filled-form");

  // ── what is on the form ──
  const state = await gEval(`(() => {
    const form = document.querySelector('form[aria-label="Edit Song Metadata Form"]');
    const chips = (box) => [...box.querySelectorAll('[class*="multiValue"]')].map((c) => c.textContent.trim());
    const field = (label) => [...form.querySelectorAll('label')].find((l) => (l.querySelector('span')?.textContent || '').replace(/\\s+/g, ' ').replace(/\\*$/, '').trim() === label);
    const rows = [...form.querySelectorAll('[id^="custom_performances-"][id$="-label"]')].map((l) => {
      const n = l.id.match(/-(\\d+)-/)[1];
      return { role: chips(l), artists: chips(document.getElementById('custom_performances-' + n + '-artists')) };
    });
    return {
      writer: chips(field('Writer')), producer: chips(field('Producer')), rows,
      youtube: form.querySelector('input[name=youtube_url]').value,
      art: form.querySelector('input[name=custom_song_art_image_url]').value,
      stillOpen: !!form, url: location.href, writes: window.__geniescraperWrites || [],
    };
  })()`);

  // What the credits say, as (role, artist) pairs. Genius's copyright roles carry a symbol; the label is the album's.
  const pair = (role, artist) => `${words(role)}|${words(artist)}`;
  const wanted = new Set();
  const writers = new Set();
  const producers = new Set();
  for (const { role, artists } of golden.credits) {
    for (const artist of artists) {
      wanted.add(pair(role, artist));
      if (["songwriter", "lyricist", "lyrics", "co-writer", "writer"].includes(role.toLowerCase()))
        writers.add(words(artist));
      if (["producer", "co-producer"].includes(role.toLowerCase())) producers.add(words(artist));
    }
  }
  const labels = [golden.phonographic_copyright, golden.copyright_notice || golden.phonographic_copyright]
    .map((line) => line.replace(/^[\u2117\u00a9]\s*\d{4}\s*/, ""))
    .flatMap((line) =>
      line.split(/,?\s+(?:under\s+(?:exclusive\s+)?licen[sc]e\s+(?:to|from)|a\s+division\s+of|distributed\s+by)\s+/i),
    );
  for (const label of labels) {
    wanted.add(pair("Phonographic Copyright", label));
    wanted.add(pair("Copyright", label));
  }

  // Every pair on the form must be a pair from the credits: an artist filed under the wrong role, or a fuzzy
  // pick, would show up here, which a check on names alone would miss.
  const newRows = state.rows.slice(before.roles);
  const wrongPairs = newRows.flatMap((row) =>
    row.artists
      .filter((artist) => !wanted.has(pair(row.role[0] ?? "", artist)))
      .map((artist) => `${row.role[0] ?? "(no role)"} / ${artist}`),
  );
  check(
    "every role and artist pair on the form is one from the credits",
    wrongPairs.length === 0,
    wrongPairs.join("; "),
  );
  const rowsWithoutRole = newRows.filter((row) => row.artists.length > 0 && row.role.length === 0);
  check("no artist sits in a row without a role", rowsWithoutRole.length === 0, String(rowsWithoutRole.length));
  const had = new Set([...before.writer, ...before.producer].map(words));
  const wrongPeople = [
    ...state.writer.filter((name) => !had.has(words(name)) && !writers.has(words(name))),
    ...state.producer.filter((name) => !had.has(words(name)) && !producers.has(words(name))),
  ];
  check("writers and producers are only people credited as such", wrongPeople.length === 0, wrongPeople.join(", "));
  check(
    "the writers Genius knows exactly were added",
    ["Billie Eilish", "FINNEAS"].every((w) => state.writer.some((c) => words(c) === words(w))),
    state.writer.join(", "),
  );
  check(
    "the producer was added",
    state.producer.some((c) => words(c) === "finneas"),
    state.producer.join(", "),
  );
  check(
    "credit rows were created and filled",
    newRows.filter((r) => r.role.length > 0 && r.artists.length > 0).length >= 3,
    String(newRows.length),
  );
  check(
    "the copyright rows use Genius's own role names",
    state.rows.some((r) => r.role.some((c) => c.startsWith("Phonographic Copyright"))),
  );
  check("the form is still open and on the same page", state.stillOpen && state.url.startsWith("https://genius.com/"));
  check("nothing that could be a save was sent", state.writes.length === 0, state.writes.join("; "));

  // ── back, and the page's own hotkey suppression ──
  const atEnd = await position();
  await press("F7", "F7", 118);
  await sleep(800);
  check("F7 goes back one step", (await position()) === atEnd - 1, `${String(atEnd)} to ${String(await position())}`);
} finally {
  // Discard the unsaved form: reloading the page throws it away.
  if (genius) await genius.send("Page.reload").catch(() => undefined);
  panel?.close();
  genius?.close();
  worker?.close();
  await browser.stop();
  rmSync(dirname(loaded), { recursive: true, force: true });
}

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${String(failures.length)} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
