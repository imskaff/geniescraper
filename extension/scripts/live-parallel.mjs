// Opt-in live benchmark of reading an album with different "tracks read at the same time" settings.
// It drives the real side-panel page against the real service worker and live Apple Music, reads the same
// 11-track album once per mode (sequentially, so timings are not skewed), and checks every mode returns the
// same credits as reading one at a time.
//
//   npm run build
//   node scripts/live-parallel.mjs --chrome <chrome.exe> [--modes 1,3,0] [--reps 1] [--grant-optional]
//
// --grant-optional runs a throwaway copy of the build whose manifest lists the optional hosts (Deezer, YouTube) as
// granted, so the worker's whole path, YouTube lookup included, runs without Chrome's permission prompt (which a
// script cannot click). The copy is made in the temp folder and never shipped; the real build is not touched.
//
// Modes are the setting values: 1 = one by one, N = N at once, 0 = every track at once. This sends more traffic
// than one normal run, so it is meant for occasional, deliberate use.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findServiceWorker, launchChromium, sleep, waitUntilReady } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
if (!chromePath) throw new Error("Pass --chrome <path to a Chromium or Chrome executable> (or set CHROME_PATH).");
const modes = option("--modes", "1,3,0").split(",").map(Number);
const reps = Number(option("--reps", "1"));
const ALBUM_URL = "https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134";

let dist = join(root, "dist");
const grant = args.includes("--grant-optional");
if (grant) {
  dist = join(mkdtempSync(join(tmpdir(), "geniescraper-granted-")), "dist");
  cpSync(join(root, "dist"), dist, { recursive: true });
  const manifestPath = join(dist, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  manifest.host_permissions = [...manifest.host_permissions, ...manifest.optional_host_permissions];
  delete manifest.optional_host_permissions;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
const browser = launchChromium({ chromePath, dist, port: 9336 });
const runs = [];
let reference = null;
try {
  const workerTarget = await findServiceWorker(browser);
  const worker = await connect(workerTarget.webSocketDebuggerUrl);
  await waitUntilReady(worker);
  const extensionId = new URL(workerTarget.url).host;
  const panelUrl = `chrome-extension://${extensionId}/ui/panel.html`;
  const tab = await browser.openTab(panelUrl);
  const panel = await connect(tab.webSocketDebuggerUrl);

  const until = async (expression, ms = 180000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await panel.evaluate(expression)) return true;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${expression}`);
  };
  const clickButton = (label) =>
    panel.evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click()`,
    );

  for (let rep = 0; rep < reps; rep++) {
    for (const mode of modes) {
      // Fresh state: the setting for this mode, and no session left over from the last one.
      await panel.evaluate(
        `chrome.storage.sync.set({ settings: { parallelReads: ${mode} } }).then(() => chrome.storage.session.clear())`,
      );
      await panel.send("Page.navigate", { url: panelUrl });
      await sleep(500);
      await until("!!document.querySelector('#link')");
      await panel.evaluate(
        `(() => { const box = document.querySelector('#link'); box.value = ${JSON.stringify(ALBUM_URL)}; document.querySelector('form').requestSubmit(); })()`,
      );
      await until("document.querySelector('h2')?.textContent === 'HIT ME HARD AND SOFT'");
      await clickButton("Select all");
      await sleep(200);
      const started = Date.now();
      await clickButton("Get credits for");
      // Watch the stored session for how many reads are in flight, until the panel says it is finished.
      let peak = 0;
      for (;;) {
        const snapshot = await panel.evaluate(
          `chrome.storage.session.get('session').then((r) => ({ loading: (r.session?.results ?? []).filter((t) => t.status === 'loading').length, status: document.querySelector('#status')?.textContent ?? '' }))`,
        );
        peak = Math.max(peak, snapshot.loading);
        if (/^Got credits for/.test(snapshot.status)) break;
        if (Date.now() - started > 180000) throw new Error("timed out reading the album");
        await sleep(40);
      }
      const seconds = (Date.now() - started) / 1000;
      const status = await panel.evaluate("document.querySelector('#status').textContent");
      const results = await panel.evaluate(
        "chrome.storage.session.get('session').then((r) => r.session.results.map((t) => ({ index: t.index, status: t.status, song: t.song })))",
      );
      const errors = results.filter((t) => t.status !== "done").length;
      const songs = JSON.stringify(results.map((t) => ({ ...t.song, youtubeUrl: undefined, youtubeIsMv: undefined })));
      reference ??= songs;
      runs.push({ mode, seconds, peak, errors, status, same: songs === reference });
      console.log(
        `mode ${mode === 0 ? "all" : mode}: ${seconds.toFixed(1)} s, peak ${peak} reads at once, ${errors} not done, same credits as one-by-one: ${songs === reference}  (${status})`,
      );
      // With the YouTube permission granted (--grant-optional) the links arrive after the credits: wait until the
      // number of tracks with a link has stopped growing, and say how long that took.
      if (grant) {
        const linkCount = () =>
          panel.evaluate(
            "chrome.storage.session.get('session').then((r) => r.session.results.filter((t) => t.song?.youtubeUrl).length)",
          );
        let links = await linkCount();
        let steady = 0;
        const waitStart = Date.now();
        while (steady < 6 && Date.now() - waitStart < 60000) {
          await sleep(1000);
          const now = await linkCount();
          steady = now === links ? steady + 1 : 0;
          links = now;
        }
        const notes = await panel.evaluate(
          "document.body.textContent.includes('limiting requests') ? 'YouTube said it was limiting requests' : 'no throttle message'",
        );
        console.log(
          `      YouTube links: ${String(links)} of ${String(results.length)} tracks, steady after ${((Date.now() - waitStart) / 1000 - 6).toFixed(0)} s more (${notes})`,
        );
      }
      await sleep(5000);
    }
  }

  console.log("\nSummary");
  for (const mode of modes) {
    const mine = runs.filter((r) => r.mode === mode);
    const times = mine.map((r) => r.seconds).sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? 0;
    console.log(
      `  ${mode === 0 ? "all at once" : `${mode} at a time`}: median ${median.toFixed(1)} s over ${mine.length} run(s), ` +
        `peak ${Math.max(...mine.map((r) => r.peak))}, failures ${mine.reduce((n, r) => n + r.errors, 0)}, ` +
        `identical to one-by-one ${mine.every((r) => r.same)}`,
    );
  }
} finally {
  await browser.stop();
}
