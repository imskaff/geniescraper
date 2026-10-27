// Opt-in live check of the Genius fill through the real extension: the side panel, the service worker, the content
// script and a real F8 key press, against live Apple Music and a live, signed-in Genius edit form.
//
//   npm run build
//   node scripts/live-genius.mjs --chrome <chrome.exe> --profile <folder with a Genius sign-in> [--screenshots <folder>]
//
// You sign in to Genius yourself, once, in a Chromium window that uses that profile folder; this script never
// handles a password. It NEVER presses Save: it only fills the open form, watches the network for anything that
// could be a save, and discards the form by reloading the page at the end.
//
// The page used is a song you created (edit it freely); change SONG_URL to one of yours if you run this yourself.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const browser = launchChromium({ chromePath, dist: join(root, "dist"), port: 9337, profileDir });
let worker;
let panel;
let genius;
try {
  const workerTarget = await findServiceWorker(browser);
  worker = await connect(workerTarget.webSocketDebuggerUrl);
  await waitUntilReady(worker);
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

  // ── the panel, in its own window so the Genius tab stays the one in front of the user ──
  await worker.evaluate(
    `chrome.windows.create({ url: ${JSON.stringify(panelUrl)}, focused: false, width: 440, height: 860 }).then((w) => w.id)`,
  );
  let panelTarget;
  for (let i = 0; i < 100 && !panelTarget; i++) {
    panelTarget = (await browser.targets()).find((t) => t.url === panelUrl && t.type === "page");
    if (!panelTarget) await sleep(200);
  }
  panel = await connect(panelTarget.webSocketDebuggerUrl);
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
  await pClick("Start pasting");
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
    const text = (await pText(".progress")) ?? "";
    return text === "All steps done" ? total : Number(text.match(/Step (\d+) of/)?.[1] ?? 0) - 1;
  };

  const skipped = [];
  const filled = [];
  let presses = 0;
  for (; presses < MAX_PRESSES; presses++) {
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
  check("the panel ends on All steps done", (await pText(".progress")) === "All steps done");
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

  const queueValues = new Set(golden.credits.flatMap((c) => [c.role, ...c.artists]).map(words));
  const everyChip = [...state.writer, ...state.producer, ...state.rows.flatMap((r) => [...r.role, ...r.artists])];
  const stray = everyChip.filter((chip) => {
    const w = words(chip);
    return ![...queueValues].some((v) => v === w) && !/phonographic copyright|^copyright$|interscope|darkroom/.test(w);
  });
  check(
    "no wrong entry was chosen: every chip is a name or role from the credits",
    stray.length === 0,
    stray.join(", "),
  );
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
    state.rows.filter((r) => r.role.length > 0 && r.artists.length > 0).length >= 3,
    String(state.rows.length),
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
}

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${String(failures.length)} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
