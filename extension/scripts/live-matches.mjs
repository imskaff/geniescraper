// Opt-in live check of "this song on Apple Music and Spotify": on real Genius song pages, the panel lists the song's
// Apple Music and Spotify pages. It sends real traffic (a few Genius pages, iTunes and Spotify look-ups, and one
// hidden Spotify search tab per song without a Spotify id), one page at a time and 15 seconds apart, so run it
// sparingly and never in a loop.
//
//   npm run build
//   node scripts/live-matches.mjs --chrome <chrome.exe> [--screenshots <folder>] [--only <case>] [--get-credits] [--headless]
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
  for (const c of CASES.filter((c) => !only || c.name === only)) {
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

    if (c.expect === "ready") {
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
      check(`${c.name}: the Apple Music row shows`, await exists('[data-key="match-apple"]'));
      check(`${c.name}: the Spotify row shows`, await exists('[data-key="match-spotify"]'));
    } else {
      // Give the panel time to ask, then it must show nothing.
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

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${String(failures.length)} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
