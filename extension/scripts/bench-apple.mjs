// Opt-in timing bench for reading Apple Music song pages with different strategies, through the built extension's
// own service worker, signed out, one scratch Chromium profile (removed on exit). Every variant reads `--tracks`
// tracks of one album, `--reps` times, and every read is compared field for field with the first baseline read of
// the same track. A rep stops at `--max-errors` failed reads (a block or captcha shows up as failures) and never
// retries. Volume is the caller's choice: page loads = 1 + variants * reps * tracks.
//
//   npm run build
//   node scripts/bench-apple.mjs --chrome <chromium.exe> --variants A,B,C --tracks 6 --reps 1 --conc 3
//
// Variants (concurrency `--conc`, default 3 as the panel; starts `--gap` ms apart, default 0):
//   A  what ships: a minimised window per track, injected once the page finished loading, shipped content script
//   B  as A with the bench reader (same waits, but reports where its time goes); must equal A
//   C  as B, injected as soon as the page commits instead of at load completion
//   D  as C, one minimised window for the whole run and a background tab per track inside it
//   E  as C, with a settle check every 40 ms instead of 150 ms
//   G  as C with the settle pause measured on message events, which hidden-tab timer throttling cannot stretch (150 ms)
//   H  as G with a 50 ms settle pause
//   F  as C, the credits-settle wait skipped (reads as soon as the first card is there): the unsafe bound
// Timings per track: create, nav (to load or to commit), inject, content (the reader's answer), close, and inside
// the reader: ready (page header or tracklist), cards (first credit card), settle, parse.
import { build } from "esbuild";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findServiceWorker, launchChromium, sleep, waitUntilReady } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const albumUrl = option("--album", "https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134");
const variants = option("--variants", "A").split(",");
const count = Number(option("--tracks", "6"));
const reps = Number(option("--reps", "1"));
const conc = Number(option("--conc", "3"));
const gap = Number(option("--gap", "0"));
const maxErrors = Number(option("--max-errors", "2"));
if (!chromePath) throw new Error("Pass --chrome <path> (or set CHROME_PATH).");

const scratch = mkdtempSync(join(tmpdir(), "geniescraper-bench-"));
cpSync(join(root, "dist"), scratch, { recursive: true });
// The bench reader: the shipped driver's own waits with the phases timed and the settle interval chosen per call.
await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: join(root, "src", "apple"),
    sourcefile: "bench-apple-content.ts",
    loader: "ts",
    contents: `
import { CARD_NAME_SELECTOR, CARD_ROLES_SELECTOR } from "./credits";
import { REAL_TIMING, scrapeTrack, waitForCredits, waitForPage } from "./driver";
import { waitFor } from "./wait";
import { parseCreditsDocument } from "./credits";
import { readCoverUrl, readReleaseDate, readTitleArtist } from "./page";

// A pause that hidden-tab timer throttling cannot stretch: message events are not throttled.
function yieldFor(ms: number): Promise<void> {
  const end = performance.now() + ms;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      if (performance.now() >= end) resolve();
      else channel.port2.postMessage(0);
    };
    channel.port2.postMessage(0);
  });
}

declare global { interface Window { __benchApple?: true } }
if (!window.__benchApple) {
  window.__benchApple = true;
  chrome.runtime.onMessage.addListener((message: any, _s, reply) => {
    if (message?.type !== "bench/scrape") return false;
    (async () => {
      const timing = { ...REAL_TIMING, settleMs: message.settleMs ?? REAL_TIMING.settleMs };
      const t0 = performance.now();
      const t: Record<string, number> = {};
      try {
        await waitForPage(document, timing);
        t.ready = performance.now() - t0;
        const [title, artist] = readTitleArtist(document);
        const coverArtUrl = readCoverUrl(document);
        const releaseDate = readReleaseDate(document);
        let s = performance.now();
        if (message.noSettle) {
          await waitFor(document, () => document.querySelector(CARD_NAME_SELECTOR), timing.creditsMs, timing.pollMs);
          t.cards = performance.now() - s;
          t.settle = 0;
        } else {
          await waitFor(document, () => document.querySelector(CARD_NAME_SELECTOR), timing.creditsMs, timing.pollMs);
          t.cards = performance.now() - s;
          s = performance.now();
          if (message.precise) {
            const text = (selector: string) => [...document.querySelectorAll(selector)].map((e) => e.textContent).join("|");
            const sig = () => text(CARD_NAME_SELECTOR) + "#" + text(CARD_ROLES_SELECTOR);
            let seen = sig();
            for (let i = 0; i < 10; i++) {
              await yieldFor(timing.settleMs);
              const next = sig();
              if (next === seen) break;
              seen = next;
            }
          } else {
            await waitForCredits(document, timing);
          }
          t.settle = performance.now() - s;
        }
        s = performance.now();
        const credits = parseCreditsDocument(document, { cardsOnly: true });
        t.parse = performance.now() - s;
        const warnings = credits.length === 0 ? ["No credits were found on this track's page."] : [];
        reply({ ok: true, data: { title: message.trackTitle || title, artist, credits, coverArtUrl, releaseDate, warnings }, timings: t });
      } catch (e: any) {
        reply({ ok: false, error: { code: e.code ?? "internal", message: String(e.message) }, timings: t });
      }
    })();
    return true;
  });
}
void scrapeTrack;
`,
  },
  outfile: join(scratch, "bench", "apple.js"),
  bundle: true,
  format: "iife",
  target: "chrome120",
  logLevel: "error",
});

const WORKER_CODE = `
(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => performance.now();
  const load = async (tabId, limit = 30000) => {
    const end = Date.now() + limit;
    while (Date.now() < end) {
      if ((await chrome.tabs.get(tabId)).status === "complete") return;
      await wait(20);
    }
    throw new Error("load timeout");
  };
  const committed = async (tabId, limit = 30000) => {
    const end = Date.now() + limit;
    while (Date.now() < end) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && tab.url.startsWith("https://music.apple.com")) return;
      await wait(10);
    }
    throw new Error("commit timeout");
  };
  const state = { win: null };
  const api = {
    async read(variant, url) {
      const t = {};
      const total0 = now();
      const early = "CDEFGH".includes(variant);
      const settleMs = variant === "E" ? 40 : variant === "H" ? 50 : variant === "G" ? 150 : undefined;
      const files = variant === "A" ? ["apple/content.js"] : ["bench/apple.js"];
      let s = now();
      let tabId, winId;
      if (variant === "D") {
        if (!state.win) {
          const w = await chrome.windows.create({ url: "about:blank", state: "minimized", focused: false });
          state.win = w.id;
        }
        tabId = (await chrome.tabs.create({ windowId: state.win, url, active: false })).id;
      } else {
        const w = await chrome.windows.create({ url, state: "minimized", focused: false });
        tabId = w.tabs[0].id; winId = w.id;
      }
      t.create = now() - s; s = now();
      if (early) await committed(tabId); else await load(tabId);
      t.nav = now() - s; s = now();
      await chrome.scripting.executeScript({ target: { tabId }, files, injectImmediately: early });
      t.inject = now() - s; s = now();
      const request = variant === "A"
        ? { type: "apple/scrape", url, trackTitle: "" }
        : { type: "bench/scrape", url, trackTitle: "", settleMs, noSettle: variant === "F", precise: variant === "G" || variant === "H" };
      const result = await chrome.tabs.sendMessage(tabId, request);
      t.content = now() - s; s = now();
      if (winId !== undefined) await chrome.windows.remove(winId).catch(() => {});
      else await chrome.tabs.remove(tabId).catch(() => {});
      t.close = now() - s;
      t.total = now() - total0;
      return { t, result };
    },
    async closeShared() {
      if (state.win) await chrome.windows.remove(state.win).catch(() => {});
      state.win = null;
    },
    async detect(url) {
      const w = await chrome.windows.create({ url, state: "minimized", focused: false });
      const id = w.tabs[0].id;
      try {
        await load(id);
        await chrome.scripting.executeScript({ target: { tabId: id }, files: ["apple/content.js"] });
        return await chrome.tabs.sendMessage(id, { type: "apple/detect", url });
      } finally {
        await chrome.windows.remove(w.id).catch(() => {});
      }
    },
  };
  self.bench = api;
})()
`;

// The disk cache is off so a page read by an earlier variant is not served from it to a later one.
const browser = launchChromium({
  chromePath,
  dist: scratch,
  port: 9344,
  extraArgs: ["--disk-cache-size=1", "--media-cache-size=1"],
});
let loads = 0;
const reference = new Map();
const table = [];
try {
  const workerTarget = await findServiceWorker(browser);
  const worker = await connect(workerTarget.webSocketDebuggerUrl);
  await waitUntilReady(worker);
  await worker.evaluate(WORKER_CODE);
  const call = (expression) =>
    worker.evaluate(`(async () => JSON.parse(JSON.stringify((await ${expression}) ?? null)))()`);

  const album = await call(`self.bench.detect(${JSON.stringify(albumUrl)})`);
  loads += 1;
  if (!album?.ok) throw new Error(`could not read the album: ${JSON.stringify(album)}`);
  const urls = album.data.trackUrls.filter(Boolean).slice(0, count);
  console.log(`album: ${String(urls.length)} tracks used, ${String(album.data.trackCount)} on the page\n`);

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  outer: for (const variant of variants) {
    for (let rep = 1; rep <= reps; rep++) {
      const t0 = Date.now();
      const done = [];
      const stages = [];
      let errors = 0;
      let correct = 0;
      let mismatches = [];
      let next = 0;
      let lastStart = -Infinity;
      const lane = async () => {
        for (;;) {
          if (errors >= maxErrors) return;
          const i = next++;
          if (i >= urls.length) return;
          const wantStart = Math.max(Date.now(), lastStart + gap);
          lastStart = wantStart;
          if (wantStart > Date.now()) await sleep(wantStart - Date.now());
          loads += 1;
          const r = await call(`self.bench.read(${JSON.stringify(variant)}, ${JSON.stringify(urls[i])})`).catch(
            (e) => ({
              result: { ok: false, error: { message: String(e) } },
            }),
          );
          done[i] = Date.now() - t0;
          if (r.t) stages.push({ ...r.t, ...(r.result?.timings ?? {}) });
          if (!r.result?.ok) {
            errors += 1;
            continue;
          }
          const key = JSON.stringify(r.result.data);
          if (!reference.has(urls[i])) reference.set(urls[i], key);
          if (reference.get(urls[i]) === key && r.result.data.credits.length > 0) correct += 1;
          else mismatches.push(i);
        }
      };
      await Promise.all(Array.from({ length: conc }, lane));
      await call("self.bench.closeShared()");
      const finished = done.filter((x) => x !== undefined).sort((a, b) => a - b);
      const whole = finished.at(-1) ?? 0;
      const row = {
        variant,
        rep,
        first: Math.round(finished[0] ?? 0),
        whole: Math.round(whole),
        per: Math.round(whole / Math.max(1, finished.length)),
        correct,
        total: urls.length,
        errors,
        mismatches: mismatches.join(",") || "-",
      };
      table.push(row);
      console.log(
        `${variant} rep${String(rep)} conc=${String(conc)}: first=${String(row.first)} ms whole=${String(row.whole)} ms per=${String(row.per)} ms correct=${String(correct)}/${String(urls.length)} errors=${String(errors)} mismatches=${row.mismatches}`,
      );
      const keys = ["create", "nav", "inject", "content", "close", "total", "ready", "cards", "settle", "parse"];
      console.log(
        "   stages (mean ms): " +
          keys
            .map(
              (k) => `${k}=${String(Math.round(mean(stages.map((s) => s[k]).filter((v) => typeof v === "number"))))}`,
            )
            .join(" "),
      );
      if (errors >= maxErrors) {
        console.log("Too many failed reads (a block, a captcha or a rate limit?): stopping now.");
        break outer;
      }
      await sleep(1000);
    }
  }
  console.log(`\npage loads used: ${String(loads)}`);
} finally {
  await browser.stop();
  rmSync(scratch, { recursive: true, force: true });
}
