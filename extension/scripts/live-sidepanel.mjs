// Opt-in live check of the way the extension is really used: the user is on an Apple Music album in a normal,
// visible tab, opens the side panel (a genuine side panel, not a tab), and the panel reads that tab in place.
//
//   npm run build
//   node scripts/live-sidepanel.mjs --chrome <chrome.exe> [--screenshots <folder>]
//
// chrome.sidePanel.open needs a user gesture; the DevTools protocol can supply one with userGesture: true.
// If Chrome refuses it, the check says so and exits non-zero instead of pretending.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findServiceWorker, launchChromium, sleep, waitUntilReady } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const shotsDir = option("--screenshots", "");
if (!chromePath) throw new Error("Pass --chrome <path to a Chromium or Chrome executable> (or set CHROME_PATH).");

const ALBUM_URL = "https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134";
const SONG_URL = "https://music.apple.com/us/song/chihiro/1739659141";

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

const browser = launchChromium({ chromePath, dist: join(root, "dist"), port: 9336 });
let worker;
let panel;
try {
  const workerTarget = await findServiceWorker(browser);
  worker = await connect(workerTarget.webSocketDebuggerUrl);
  await waitUntilReady(worker);
  // A fresh profile starts with the first-time set-up; this check is about the side panel, so mark it as done.
  await worker.evaluate("chrome.storage.sync.set({ settings: { onboarded: true } })");
  const extensionId = new URL(workerTarget.url).host;
  const panelUrl = `chrome-extension://${extensionId}/ui/panel.html`;

  const appleTabs = () =>
    worker.evaluate(
      "chrome.tabs.query({}).then((tabs) => tabs.filter((t) => (t.url || '').includes('music.apple.com')).map((t) => ({ id: t.id, url: t.url, active: t.active })))",
    );
  const activate = (id) => worker.evaluate(`chrome.tabs.update(${String(id)}, { active: true }).then(() => true)`);

  // The user's own tabs: the album first, then a song page opened later on.
  await browser.openTab(ALBUM_URL);
  let tabA;
  for (let i = 0; i < 100 && !tabA; i++) {
    tabA = (await appleTabs()).find((t) => t.url === ALBUM_URL);
    if (!tabA) await sleep(200);
  }
  check("the album is open in a normal tab", Boolean(tabA));
  await activate(tabA.id);
  await sleep(1500); // let the album finish rendering, as it would before the user clicks the toolbar

  // Open the real side panel for that window. The call needs a user gesture, which a service worker cannot be
  // given, so a helper window shows an extension page and makes the call from there with a gesture.
  const windowId = await worker.evaluate(`chrome.tabs.get(${String(tabA.id)}).then((t) => t.windowId)`);
  const helperWindowId = await worker.evaluate(
    `chrome.windows.create({ url: ${JSON.stringify(`${panelUrl}?helper`)}, focused: false }).then((w) => w.id)`,
  );
  let helper;
  for (let i = 0; i < 100 && !helper; i++) {
    helper = (await browser.targets()).find((t) => t.url === `${panelUrl}?helper`);
    if (!helper) await sleep(200);
  }
  const helperSession = await connect(helper.webSocketDebuggerUrl);
  let opened = true;
  try {
    await helperSession.evaluate(`chrome.sidePanel.open({ windowId: ${String(windowId)} }).then(() => true)`, {
      userGesture: true,
    });
  } catch (error) {
    opened = false;
    console.log(`      sidePanel.open refused: ${String(error.message).slice(0, 200)}`);
  }
  helperSession.close();
  await worker.evaluate(`chrome.windows.remove(${String(helperWindowId)}).then(() => true)`);
  check("the side panel opens for the window", opened);
  if (!opened) throw new Error("Cannot continue without the side panel; ask for one manual run.");

  let target;
  for (let i = 0; i < 100 && !target; i++) {
    target = (await browser.targets()).find((t) => t.url === panelUrl && t.type !== "service_worker");
    if (!target) await sleep(200);
  }
  check("the side panel is a real panel target, not a tab we opened", Boolean(target), target ? target.type : "");
  panel = await connect(target.webSocketDebuggerUrl);
  const text = (selector) => panel.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const value = (selector) => panel.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
  const until = async (expression, what, ms = 15000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await panel.evaluate(expression).catch(() => false)) return true;
      await sleep(200);
    }
    check(`waited for ${what}`, false, "timed out");
    return false;
  };
  const shot = async (name) => {
    if (!shotsDir) return;
    mkdirSync(shotsDir, { recursive: true });
    const { data } = await panel.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, "base64"));
  };

  await until("!!document.querySelector('#link')", "the link screen");
  await until(`document.querySelector('#link').value === ${JSON.stringify(ALBUM_URL)}`, "the prefilled link", 5000);
  check(
    "the link box is prefilled with the page the user is on",
    (await value("#link")) === ALBUM_URL,
    String(await value("#link")),
  );
  check("the panel says it filled the link in", (await text("#link-help"))?.includes("filled in"));

  // Following the user to another tab.
  await browser.openTab(SONG_URL);
  await until(
    `document.querySelector('#link').value === ${JSON.stringify(SONG_URL)}`,
    "the prefill to follow the new tab",
    8000,
  );
  check("opening a song tab updates the prefill", (await value("#link")) === SONG_URL, String(await value("#link")));
  await activate(tabA.id);
  await until(
    `document.querySelector('#link').value === ${JSON.stringify(ALBUM_URL)}`,
    "the prefill to follow back",
    8000,
  );
  check(
    "switching back to the album tab restores the prefill",
    (await value("#link")) === ALBUM_URL,
    String(await value("#link")),
  );
  const tabsBefore = await appleTabs();
  await shot("sidepanel-1-prefilled");

  // Read it. Watch every Apple Music tab that exists while the panel works.
  let peak = 0;
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      peak = Math.max(
        peak,
        (await browser.targets()).filter((t) => t.type === "page" && t.url.includes("music.apple.com")).length,
      );
      await sleep(50);
    }
  })();
  await panel.evaluate(
    "document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))",
  );
  await until("document.querySelector('h2')?.textContent === 'HIT ME HARD AND SOFT'", "the track list");
  await sleep(500);
  watching = false;
  await watcher;

  check(
    "the album was read in place: no tab was opened for it",
    peak === tabsBefore.length,
    `peak ${String(peak)} vs ${String(tabsBefore.length)} open`,
  );
  const tabsAfter = await appleTabs();
  check(
    "the user's tabs are untouched",
    tabsBefore.every((t) => tabsAfter.some((a) => a.id === t.id && a.url === t.url)),
  );
  const boxes = await panel.evaluate("document.querySelectorAll('input[type=checkbox]').length");
  check("the track list shows 11 tracks", boxes === 11, String(boxes));
  await shot("sidepanel-2-tracks");
} finally {
  panel?.close();
  worker?.close();
  await browser.stop();
}

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${String(failures.length)} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
