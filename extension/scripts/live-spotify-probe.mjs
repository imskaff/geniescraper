// Opt-in live probe of the signed-out Spotify web player, driven through a real (throwaway) extension so the reader
// runs where the future provider would: as a content script in the isolated world, injected by a service worker
// into a tab that the user is not looking at. Replaces the earlier spikes live-spotify.mjs and live-spotify-open.mjs,
// which used raw page scripts and could not reset a hidden page.
//
//   node scripts/live-spotify-probe.mjs --chrome <chrome.exe> --steps "<kind>/<id>@<env>,..." [options]
//
//   kind     track | album
//   env      tab        a background tab in a window that has another tab in front (the shipped design)
//            minimised  a minimised window
//            offscreen  a window at -4000,-4000
//            visible    a normal focused window
//   options  --out <file.json>   write the results
//            --delay 5000        pause between page loads (ms)
//            --lang de-DE        Chrome UI and Accept-Language for the whole run
//            --intl en           add the /intl-en/ URL prefix (default: none; "none" is also accepted)
//            --limit 3           album only: how many tracks to open credits for (0 = all)
//            --force-en          send Accept-Language: en-US for the probe's tab with a session declarativeNetRequest rule (adds that permission)
//            --fetch-meta        also GET the page once more and read the server-rendered meta tags
//
// Rules: signed out, no credentials, open.spotify.com only, one page at a time, one window in a throwaway profile
// that is removed on exit, and the run stops at the first captcha or block text. Only reads; never clicks Follow,
// Save or anything outside the options menu and the credits dialog.
//
// The test extension is written to a temporary folder (never to extension/src) with the minimum permissions the
// provider would need: `scripting` plus a host permission for open.spotify.com.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clearTimeout } from "node:timers";
import { connect, findServiceWorker, launchChromium, sleep, waitUntilReady } from "./lib/cdp.mjs";
import { readerSource, spotifyUrl } from "./lib/spotify-read.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const steps = option("--steps", "")
  .split(",")
  .filter(Boolean)
  .map((s) => {
    const match = /^(track|album)\/([A-Za-z0-9]+)@(tab|minimised|offscreen|visible)$/.exec(s);
    if (!match) throw new Error(`Bad step "${s}", expected <track|album>/<id>@<env>.`);
    return { kind: match[1], id: match[2], env: match[3] };
  });
const delay = Number(option("--delay", "5000"));
const lang = option("--lang", "");
const intl = option("--intl", "none");
const limit = Number(option("--limit", "3"));
const wantMeta = args.includes("--fetch-meta");
const forceEn = args.includes("--force-en");
const outFile = option("--out", "");
const port = 9371;
if (!chromePath || steps.length === 0) throw new Error("Pass --chrome and --steps.");

// The throwaway extension. The content script answers one message per page.
const CONTENT = `
const R = ${readerSource};
const visibility = () => document.visibilityState;
async function run(message) {
  const t0 = Date.now();
  const base = { visibility: visibility(), htmlLang: document.documentElement.lang, world: "isolated", pathname: location.pathname, navLang: navigator.language };
  if (message.kind === "album") {
    const list = await R.readAlbumTracks(document);
    const rows = list.rows;
    const wanted = message.limit > 0 ? rows.slice(0, message.limit) : rows;
    const tracks = [];
    for (const row of wanted) {
      const t1 = Date.now();
      row.more?.scrollIntoView({ block: "center" });
      const result = row.more ? await R.readCredits(document, { button: row.more, timeoutMs: 3000 }) : { status: "no-button" };
      tracks.push({ id: row.id, title: row.title, ms: Date.now() - t1, status: result.status, rows: result.rows?.length ?? 0, how: result.how, heading: result.heading, menu: result.menu, dialogTitle: result.title, steps: result.steps });
      await R.closeDialog(document);
      await new Promise((r) => setTimeout(r, 400));
    }
    const dateTexts = [...document.querySelectorAll("main span, main p, main div")]
      .filter((e) => e.children.length === 0 && /[0-9]{4}/.test(e.textContent) && /[0-9]{1,2}/.test(e.textContent.replace(/[0-9]{4}/, "")) && e.textContent.length < 40)
      .map((e) => (e.getAttribute("data-testid") ?? "") + "|" + e.textContent.trim())
      .slice(0, 6);
    return { ...base, header: R.readHeader(document), copyright: R.readCopyright(document), dateTexts, rowCount: rows.length, complete: list.complete, rowsWithButton: rows.filter((r) => r.more).length, tracks, totalMs: Date.now() - t0, firstRows: rows.slice(0, 3).map(({ more, ...r }) => ({ ...r, hasButton: !!more })), meta: message.meta ? await R.fetchMeta(location.href).catch((e) => ({ error: String(e) })) : undefined };
  }
  const credits = await R.readCredits(document);
  const out = { ...base, header: R.readHeader(document), copyright: R.readCopyright(document), liveMeta: R.readMeta(document), moreLabel: R.findMoreButton(document)?.getAttribute("aria-label") ?? null, credits, totalMs: Date.now() - t0, bodyStart: credits.status === "ok" ? undefined : (document.body.innerText || "").slice(0, 400) };
  if (message.meta) out.fetchedMeta = await R.fetchMeta(location.href).catch((e) => ({ error: String(e) }));
  await R.closeDialog(document);
  return out;
}
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  run(message).then(reply, (e) => reply({ error: String(e && e.stack || e) }));
  return true;
});
`;

const WORKER = `
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
self.drive = async (job) => {
  let win;
  const started = Date.now();
  try {
    if (job.env === "tab") {
      win = await chrome.windows.create({ url: "about:blank", focused: false, width: 1100, height: 800 });
      const tab = await chrome.tabs.create({ windowId: win.id, url: job.forceEn ? "about:blank" : job.url, active: false });
      job.tabId = tab.id;
      if (job.forceEn) {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [1],
          addRules: [
            {
              id: 1,
              priority: 1,
              action: { type: "modifyHeaders", requestHeaders: [{ header: "Accept-Language", operation: "set", value: "en-US,en;q=0.9" }] },
              condition: { requestDomains: ["open.spotify.com"], tabIds: [tab.id], resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "script", "other"] },
            },
          ],
        });
        await chrome.tabs.update(tab.id, { url: job.url });
      }
    } else if (job.env === "minimised") {
      win = await chrome.windows.create({ url: job.url, state: "minimized" });
      job.tabId = win.tabs[0].id;
    } else if (job.env === "offscreen") {
      win = await chrome.windows.create({ url: job.url, left: -4000, top: -4000, width: 1100, height: 800, focused: false });
      job.tabId = win.tabs[0].id;
    } else {
      win = await chrome.windows.create({ url: job.url, focused: true, width: 1100, height: 800 });
      job.tabId = win.tabs[0].id;
    }
    for (let i = 0; i < 300; i++) {
      if ((await chrome.tabs.get(job.tabId)).status === "complete") break;
      await wait(100);
    }
    const loadedMs = Date.now() - started;
    await chrome.scripting.executeScript({ target: { tabId: job.tabId }, files: ["content.js"] });
    const result = await chrome.tabs.sendMessage(job.tabId, job.message);
    const tab = await chrome.tabs.get(job.tabId);
    return { loadedMs, tabActive: tab.active, windowState: (await chrome.windows.get(win.id)).state, result };
  } finally {
    if (win) await chrome.windows.remove(win.id).catch(() => undefined);
    if (job.forceEn) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1] }).catch(() => undefined);
  }
};
`;

const extDir = mkdtempSync(join(tmpdir(), "geniescraper-spotify-ext-"));
writeFileSync(
  join(extDir, "manifest.json"),
  JSON.stringify({
    manifest_version: 3,
    name: "Spotify probe (throwaway)",
    version: "0.0.1",
    permissions: forceEn ? ["scripting", "declarativeNetRequest"] : ["scripting"],
    host_permissions: ["https://open.spotify.com/*"],
    background: { service_worker: "background/worker.js" },
  }),
);
mkdirSync(join(extDir, "background"));
writeFileSync(join(extDir, "background", "worker.js"), WORKER);
writeFileSync(join(extDir, "content.js"), CONTENT);

const langArgs = lang ? [`--lang=${lang}`, `--accept-lang=${lang}`] : [];
const browser = launchChromium({ chromePath, dist: extDir, port, extraArgs: langArgs });
const hardStop = setTimeout(async () => {
  console.log("TIMEOUT");
  await browser.stop();
  rmSync(extDir, { recursive: true, force: true });
  process.exit(2);
}, 1_500_000);

const records = [];
let blocker = null;
let worker;
try {
  worker = await connect((await findServiceWorker(browser)).webSocketDebuggerUrl);
  await waitUntilReady(worker);
  for (const step of steps) {
    const url = spotifyUrl(step.kind, step.id, { intl: intl === "none" ? "" : intl });
    const job = { url, forceEn, env: step.env, message: { kind: step.kind, limit, meta: wantMeta } };
    const record = { ...step, intl, lang };
    const t0 = Date.now();
    try {
      Object.assign(record, await worker.evaluate(`self.drive(${JSON.stringify(job)})`));
    } catch (error) {
      record.error = String(error.message ?? error).slice(0, 300);
    }
    record.ms = Date.now() - t0;
    records.push(record);
    const status =
      record.result?.credits?.status ?? record.result?.tracks?.map((t) => t.status).join("/") ?? record.error;
    console.log(
      `${step.kind}/${step.id}@${step.env} ${status} vis=${record.result?.visibility} ${String(record.ms)}ms`,
    );
    if (record.result?.credits?.status === "blocked" || record.result?.tracks?.some((t) => t.status === "blocked")) {
      blocker = `block text on ${step.id}`;
      break;
    }
    await sleep(delay);
  }
} finally {
  clearTimeout(hardStop);
  worker?.close();
  await browser.stop();
  rmSync(extDir, { recursive: true, force: true });
}
const summary = { loads: records.length, blocker, records };
if (outFile) {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(summary, null, 1));
}
if (blocker) console.log("STOPPED:", blocker);
console.log(`${String(records.length)} page loads`);
