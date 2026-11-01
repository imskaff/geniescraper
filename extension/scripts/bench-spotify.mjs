// Opt-in timing bench for reading Spotify credits with different tab strategies, through the built extension's own
// service worker and content script, signed out, one scratch Chrome profile and window (removed on exit). It stops at
// the first captcha, block or 429 and never retries past it. Volume is the caller's choice: every variant reads
// `--tracks` tracks of one album, `--reps` times.
//
//   npm run build
//   node scripts/bench-spotify.mjs --chrome <chrome.exe> --album <id> --variants A,B,C,D,E --tracks 8 --reps 2
//
// Variants (concurrency `--conc`, default 1; starts are `--gap` ms apart, default 300):
//   A  a new minimised window per track, injected after load (what ships)
//   B  one minimised window; a new background tab per track inside it
//   C  one tab navigated to each track in turn
//   D  as A, but the reader is injected as soon as the page commits, not at load completion
//   E  one album tab; each track read from its own row's options menu (no navigation at all)
//   F  as B with early injection (B + D)
// Like live-spotify-provider.mjs, the host is made required in a scratch copy of dist/ (a script cannot click Chrome's prompt).
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findServiceWorker, launchChromium, sleep, waitUntilReady } from "./lib/cdp.mjs";
import { readerSource } from "./lib/spotify-read.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const albumId = option("--album", "4yP0hdKOZPNshxUOjY0cZj");
const variants = option("--variants", "A").split(",");
const count = Number(option("--tracks", "8"));
const reps = Number(option("--reps", "2"));
const conc = Number(option("--conc", "1"));
const gap = Number(option("--gap", "300"));
const lang = option("--lang", "en-US");
if (!chromePath) throw new Error("Pass --chrome <path> (or set CHROME_PATH).");

const scratch = mkdtempSync(join(tmpdir(), "geniescraper-bench-"));
cpSync(join(root, "dist"), scratch, { recursive: true });
const manifestPath = join(scratch, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
manifest.optional_host_permissions = manifest.optional_host_permissions.filter(
  (h) => h !== "https://open.spotify.com/*",
);
manifest.host_permissions = [...manifest.host_permissions, "https://open.spotify.com/*"];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
// Variant E reads through the rows of the album page; the research reader does that (bench only, not shipped).
mkdirSync(join(scratch, "bench"), { recursive: true });
writeFileSync(
  join(scratch, "bench", "rows.js"),
  `const R = ${readerSource};
if (!window.__benchRows) {
  window.__benchRows = true;
  chrome.runtime.onMessage.addListener((message, _s, reply) => {
    if (message.type !== "bench/rows") return false;
    (async () => {
      const t0 = Date.now();
      const list = await R.readAlbumTracks(document, { settleMs: 600 });
      const out = [];
      for (const row of list.rows.slice(0, message.count)) {
        const t1 = Date.now();
        const result = await R.readCredits(document, { button: row.more, timeoutMs: 3000 });
        out.push({ id: row.id, status: result.status, rows: result.rows?.length ?? 0, ms: Date.now() - t1 });
        await R.closeDialog(document);
      }
      reply({ listMs: Date.now() - t0, tracks: out });
    })().catch((e) => reply({ error: String(e) }));
    return true;
  });
}
`,
);

const WORKER_CODE = `
(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => performance.now();
  const BLOCK = /captcha|unusual traffic|too many requests/i;
  const load = async (tabId, limit = 20000) => {
    const end = Date.now() + limit;
    while (Date.now() < end) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
      await wait(20);
    }
    throw new Error("load timeout");
  };
  const committed = async (tabId, limit = 20000) => {
    const end = Date.now() + limit;
    while (Date.now() < end) {
      const tab = await chrome.tabs.get(tabId);
      if ((tab.url || tab.pendingUrl || "").startsWith("https://open.spotify.com") && tab.url) return;
      await wait(10);
    }
    throw new Error("commit timeout");
  };
  const inject = (tabId, early) =>
    chrome.scripting.executeScript({ target: { tabId }, files: ["spotify/content.js"], injectImmediately: early });
  const ask = (tabId, url) => chrome.tabs.sendMessage(tabId, { type: "spotify/scrape", url, trackTitle: "" });
  const state = { win: null, tab: null };
  const api = {
    async open(variant, url) {
      const t = { };
      const s0 = now();
      const early = variant === "D" || variant === "F";
      if (variant === "A" || variant === "D") {
        const win = await chrome.windows.create({ url, state: "minimized", focused: false });
        t.id = win.tabs[0].id; t.win = win.id;
      } else if (variant === "B" || variant === "F") {
        if (!state.win) {
          const win = await chrome.windows.create({ url: "about:blank", state: "minimized", focused: false });
          state.win = win.id;
        }
        const tab = await chrome.tabs.create({ windowId: state.win, url, active: false });
        t.id = tab.id;
      } else if (variant === "C") {
        if (state.tab === null) {
          const win = await chrome.windows.create({ url: "about:blank", state: "minimized", focused: false });
          state.win = win.id; state.tab = win.tabs[0].id;
        }
        await chrome.tabs.update(state.tab, { url });
        t.id = state.tab;
      }
      t.create = now() - s0;
      return { t, early };
    },
    async read(variant, url) {
      const total0 = now();
      const { t, early } = await api.open(variant, url);
      const s1 = now();
      if (early) await committed(t.id); else await load(t.id);
      t.nav = now() - s1;
      const s2 = now();
      await inject(t.id, early);
      t.inject = now() - s2;
      const s3 = now();
      const result = await ask(t.id, url);
      t.content = now() - s3;
      const s4 = now();
      if (variant === "A" || variant === "D") await chrome.windows.remove(t.win).catch(() => {});
      else if (variant === "B" || variant === "F") await chrome.tabs.remove(t.id).catch(() => {});
      t.close = now() - s4;
      t.total = now() - total0;
      const data = result && result.ok ? result.data : null;
      return { t, ok: !!data && data.credits.length > 0, error: result && !result.ok ? result.error.code : null, timings: data ? data.timings : null, blocked: result && !result.ok && result.error.code === "blocked" };
    },
    async rows(albumUrl, count) {
      const win = await chrome.windows.create({ url: albumUrl, state: "minimized", focused: false });
      const tabId = win.tabs[0].id;
      try {
        const s0 = now();
        await load(tabId);
        const nav = now() - s0;
        await chrome.scripting.executeScript({ target: { tabId }, files: ["bench/rows.js"] });
        const out = await chrome.tabs.sendMessage(tabId, { type: "bench/rows", count });
        return { nav, ...out, total: now() - s0 };
      } finally {
        await chrome.windows.remove(win.id).catch(() => {});
      }
    },
    async closeShared() {
      if (state.win) await chrome.windows.remove(state.win).catch(() => {});
      state.win = null; state.tab = null;
    },
  };
  self.bench = api;
})()
`;

const failures = [];
const browser = launchChromium({
  chromePath,
  dist: scratch,
  port: 9343,
  extraArgs: [`--lang=${lang}`, `--accept-lang=${lang}`],
});
let loads = 0;
try {
  const workerTarget = await findServiceWorker(browser);
  const worker = await connect(workerTarget.webSocketDebuggerUrl);
  await waitUntilReady(worker);
  await worker.evaluate(WORKER_CODE);
  const call = (expression) =>
    worker.evaluate(`(async () => JSON.parse(JSON.stringify((await ${expression}) ?? null)))()`);

  // The album's track ids, through the shipped reader (one page load).
  const albumUrl = `https://open.spotify.com/album/${albumId}`;
  await call(`chrome.windows.create({ url: ${JSON.stringify(albumUrl)}, state: "minimized", focused: false }).then(async (w) => {
    const id = w.tabs[0].id;
    for (let i = 0; i < 200; i++) { if ((await chrome.tabs.get(id)).status === "complete") break; await new Promise((r) => setTimeout(r, 50)); }
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ["spotify/content.js"] });
    const r = await chrome.tabs.sendMessage(id, { type: "spotify/detect", url: ${JSON.stringify(albumUrl)} });
    await chrome.windows.remove(w.id);
    self.__album = r; return 1; })`);
  loads += 1;
  const album = await call("self.__album");
  const urls = album.data.trackUrls.filter(Boolean).slice(0, count);
  console.log(`album ${albumId}: ${String(urls.length)} tracks used\n`);

  const rows = [];
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  outer: for (const variant of variants) {
    for (let rep = 1; rep <= reps; rep++) {
      const t0 = Date.now();
      const done = [];
      let blocked = false;
      let errors = 0;
      let correct = 0;
      const stages = [];
      if (variant === "E") {
        const out = await call(`self.bench.rows(${JSON.stringify(albumUrl)}, ${String(count)})`);
        loads += 1;
        if (out.error) throw new Error(out.error);
        let at = out.nav + out.listMs;
        for (const track of out.tracks) {
          at += track.ms;
          done.push(at);
          if (track.status === "ok") correct += 1;
          else errors += 1;
        }
      } else {
        let next = 0;
        let lastStart = -Infinity;
        const lane = async () => {
          for (;;) {
            if (blocked) return;
            const i = next++;
            if (i >= urls.length) return;
            const wantStart = Math.max(Date.now(), lastStart + gap);
            lastStart = wantStart;
            if (wantStart > Date.now()) await sleep(wantStart - Date.now());
            loads += 1;
            const r = await call(`self.bench.read(${JSON.stringify(variant)}, ${JSON.stringify(urls[i])})`).catch(
              (e) => ({ error: String(e), ok: false }),
            );
            done[i] = Date.now() - t0;
            if (r.blocked) blocked = true;
            if (r.ok) correct += 1;
            else errors += 1;
            if (r.t) stages.push({ ...r.t, ...(r.timings ?? {}) });
          }
        };
        await Promise.all(Array.from({ length: conc }, lane));
        await call("self.bench.closeShared()");
      }
      const finished = done.filter((x) => x !== undefined).sort((a, b) => a - b);
      const whole = finished.at(-1) ?? 0;
      rows.push({
        variant,
        rep,
        first: finished[0] ?? 0,
        whole,
        per: Math.round(whole / Math.max(1, finished.length)),
        correct,
        total: urls.length,
        errors,
      });
      console.log(
        `${variant} rep${String(rep)} conc=${String(variant === "E" ? 1 : conc)}: first=${String(Math.round(finished[0] ?? 0))} ms whole=${String(Math.round(whole))} ms per=${String(Math.round(whole / Math.max(1, finished.length)))} ms correct=${String(correct)}/${String(urls.length)} errors=${String(errors)}`,
      );
      if (stages.length) {
        const keys = ["create", "nav", "inject", "content", "close", "header", "button", "menu", "dialog", "parsed"];
        console.log(
          "   stages (mean ms): " +
            keys
              .map(
                (k) => `${k}=${String(Math.round(mean(stages.map((s) => s[k]).filter((v) => typeof v === "number"))))}`,
              )
              .join(" "),
        );
      }
      if (blocked) {
        console.log("CAPTCHA or block seen: stopping now.");
        failures.push("blocked");
        break outer;
      }
      await sleep(1500);
    }
  }
  console.log(`\nSpotify page loads this run: about ${String(loads)}`);
  console.log(JSON.stringify(rows));
} catch (error) {
  console.error(error);
  failures.push(String(error));
} finally {
  await browser.stop();
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(failures.length === 0 ? 0 : 1);
