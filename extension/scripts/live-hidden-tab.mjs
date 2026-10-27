// Opt-in live check of the extension's central design decision: Apple Music song pages can be read in a
// genuinely hidden tab. It launches Chromium with the unpacked extension (run `npm run build` first),
// talks to the service worker over raw CDP, and drives detect and scrape in inactive tabs.
//
// Playwright is deliberately not used: it forces pages to report as visible and focused, which hides
// exactly the behaviour measured here. This hits live Apple Music like a normal user, a few page loads a run.
//
//   node scripts/live-hidden-tab.mjs --chrome <chrome.exe> [--runs 3]
//
// Exit code 0 only when every run matched the golden file for tests/golden/eilish-hmhas-t3.json.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const runs = Number(option("--runs", "3"));
if (!chromePath) throw new Error("Pass --chrome <path to a Chromium or Chrome executable> (or set CHROME_PATH).");

const dist = join(root, "dist");
const golden = JSON.parse(readFileSync(join(root, "..", "tests", "golden", "eilish-hmhas-t3.json"), "utf-8"));
const ALBUM_URL = "https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134";
const TRACK_INDEX = 2; // zero-based: CHIHIRO, the third track
const PORT = 9333;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = mkdtempSync(join(tmpdir(), "geniescraper-hidden-tab-"));
const chrome = spawn(
  chromePath,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function targets() {
  try {
    return await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  } catch {
    return [];
  }
}

async function connectToWorker() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const worker = (await targets()).find((t) => t.type === "service_worker" && t.url.endsWith("background/worker.js"));
    if (worker) return new WebSocket(worker.webSocketDebuggerUrl);
    await sleep(200);
  }
  throw new Error("The extension's service worker did not start. Did you run `npm run build`?");
}

// Runs in the worker: open an inactive tab, inject the content script, ask it one question, close the tab.
const drive = (message) => `(async () => {
  const message = ${JSON.stringify(message)};
  const tab = await chrome.tabs.create({ url: message.url, active: false });
  const started = Date.now();
  try {
    for (let i = 0; i < 200; i++) {
      if ((await chrome.tabs.get(tab.id)).status === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['apple/content.js'] });
    const [{ result: visibility }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.visibilityState,
    });
    const result = await chrome.tabs.sendMessage(tab.id, message);
    return { result, ms: Date.now() - started, visibility, active: (await chrome.tabs.get(tab.id)).active };
  } finally {
    await chrome.tabs.remove(tab.id);
  }
})()`;

function creditMap(credits) {
  const byRole = {};
  for (const { role, artists } of credits) byRole[role] = [...new Set([...(byRole[role] ?? []), ...artists])].sort();
  return JSON.stringify(Object.entries(byRole).sort(([a], [b]) => a.localeCompare(b)));
}

const socket = await connectToWorker();
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let nextId = 1;
const waiting = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  waiting.get(message.id)?.(message);
});
function evaluate(expression) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, (message) => {
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result.result.value);
    });
    socket.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
}

const wanted = creditMap(golden.credits);
let matched = 0;
try {
  for (let run = 1; run <= runs; run++) {
    const detect = await evaluate(drive({ type: "apple/detect", url: ALBUM_URL }));
    const album = detect.result.data;
    const scrape = await evaluate(
      drive({ type: "apple/scrape", url: album.trackUrls[TRACK_INDEX], trackTitle: album.trackTitles[TRACK_INDEX] }),
    );
    const page = scrape.result;
    const copyrightMatches =
      album.phonographicCopyright === golden.phonographic_copyright &&
      album.copyrightNotice === golden.copyright_notice;
    const ok =
      page.ok &&
      creditMap(page.data.credits) === wanted &&
      page.data.title === golden.title &&
      page.data.artist === golden.artist &&
      copyrightMatches;
    if (ok) matched++;
    const hidden = detect.visibility === "hidden" && scrape.visibility === "hidden";
    console.log(
      `run ${String(run)}: ${ok ? "MATCH" : "MISMATCH"} | detect ${String(detect.ms)} ms, scrape ${String(scrape.ms)} ms | ` +
        `tabs hidden: ${String(hidden)}, inactive: ${String(!detect.active && !scrape.active)}`,
    );
    if (!ok) console.log(JSON.stringify(page).slice(0, 400));
    await sleep(1000);
  }
} finally {
  socket.close();
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
console.log(`${String(matched)}/${String(runs)} runs matched the golden file`);
process.exit(matched === runs ? 0 : 1);
