// Opt-in live check of the Spotify provider through the built extension and its real side-panel page, signed out,
// against open.spotify.com. Low volume on purpose: one Chrome window in a throwaway profile (removed on exit), one
// Spotify page at a time, a handful of loads, and a stop at the first captcha or block.
//
//   npm run build
//   node scripts/live-spotify-provider.mjs --chrome <chrome.exe> [--lang en-US] [--screenshots <folder>]
//        [--album <id>] [--album-tracks 3] [--tracks <id>,<id>] [--unavailable] [--tab] [--plain]
//
// An optional host permission cannot be granted from a script (Chrome's prompt needs a real click), so this check
// loads a scratch copy of dist/ whose manifest lists open.spotify.com as a required host. Everything else is the
// shipped build; the permission prompt flow itself is covered by the panel tests, not here.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findServiceWorker, launchChromium, sleep, waitUntilReady } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
if (!chromePath) throw new Error("Pass --chrome <path to Chrome or Chromium> (or set CHROME_PATH).");
const lang = option("--lang", "en-US");
const shotsDir = option("--screenshots", "");
const albumId = option("--album", "");
// Any other album address (an Apple Music one, to time the same read for comparison).
const albumUrl = option("--album-url", "") || (albumId ? `https://open.spotify.com/album/${albumId}` : "");
const albumTracks = Number(option("--album-tracks", "3"));
const trackIds = option("--tracks", "").split(",").filter(Boolean);
const wantUnavailable = args.includes("--unavailable");
const wantTab = args.includes("--tab");
// The open-pages card must name the page, not the song that is playing: the tab title is rewritten here to another song.
const wantDetector = args.includes("--detector");
// What Chrome tells the panel about an open Spotify tab while access is not granted (needs --ungranted).
// With --detector: also move inside the player (a track link click, no page load) while a song plays, and watch the card.
const wantSpa = args.includes("--spa");
const wantNoAccessTab = args.includes("--noaccess-tab");
// The shipped build as it is: Spotify not allowed yet. Nothing is loaded from Spotify; the explanation card shows.
const ungranted = args.includes("--ungranted");
// Timing runs: `--all` reads every listed track of the album and prints when each one finished; `--before` patches the
// scratch build to the old schedule (one page at a time, 2.5 s apart) so the same album can be timed both ways.
const readAll = args.includes("--all");
const before = args.includes("--before");
// `--plain` patches the scratch build to open the plain address (no ?locale=en), to time and compare the old read.
const plain = args.includes("--plain");

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

// A scratch copy of the build with the Spotify host required, so the prompt is not needed.
const scratch = mkdtempSync(join(tmpdir(), "geniescraper-spotify-dist-"));
cpSync(join(root, "dist"), scratch, { recursive: true });
const manifestPath = join(scratch, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
if (before) {
  const workerPath = join(scratch, "background", "worker.js");
  const code = readFileSync(workerPath, "utf-8");
  if (!/readGapMs: 300,\s*readConcurrency: 2/.test(code))
    throw new Error("--before: the schedule was not found in the build.");
  writeFileSync(
    workerPath,
    code.replace(/readGapMs: 300,\s*readConcurrency: 2/, "readGapMs: 2500, readConcurrency: 1"),
  );
}
if (plain) {
  const workerPath = join(scratch, "background", "worker.js");
  const code = readFileSync(workerPath, "utf-8");
  if (!code.includes("?locale=en")) throw new Error("--plain: the English query was not found in the build.");
  writeFileSync(workerPath, code.replaceAll("?locale=en", ""));
}
if (!ungranted) {
  manifest.optional_host_permissions = manifest.optional_host_permissions.filter(
    (h) => h !== "https://open.spotify.com/*",
  );
  manifest.host_permissions = [...manifest.host_permissions, "https://open.spotify.com/*"];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

let loads = 0;
const browser = launchChromium({
  chromePath,
  dist: scratch,
  port: 9341,
  extraArgs: [`--lang=${lang}`, `--accept-lang=${lang}`],
});
let panel;
try {
  const workerTarget = await findServiceWorker(browser);
  const worker = await connect(workerTarget.webSocketDebuggerUrl);
  await waitUntilReady(worker);
  const extensionId = new URL(workerTarget.url).host;
  const tab = await browser.openTab(`chrome-extension://${extensionId}/ui/panel.html`);
  panel = await connect(tab.webSocketDebuggerUrl);
  await panel.send("Emulation.setDeviceMetricsOverride", {
    width: 400,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const evalPanel = (expression) => panel.evaluate(expression);
  // Skip the first-run set-up, as a user who has finished it would.
  await evalPanel("chrome.storage.sync.set({ settings: { onboarded: true } })");
  await evalPanel("location.reload()");
  await sleep(1500);
  const until = async (expression, what, ms = 60000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await evalPanel(expression)) return true;
      await sleep(250);
    }
    check(`waited for ${what}`, false, "timed out");
    return false;
  };
  const shot = async (name) => {
    if (!shotsDir) return;
    mkdirSync(shotsDir, { recursive: true });
    const { data } = await panel.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, "base64"));
  };
  const pageText = () => evalPanel("document.body.innerText");
  const submitLink = async (url) => {
    await evalPanel(
      `(() => { const i = document.querySelector('#link'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(url)}); i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('form').requestSubmit(); })()`,
    );
    loads += 1;
  };
  const clickKey = (key) => evalPanel(`document.querySelector('[data-key=${JSON.stringify(key)}]').click()`);
  const blocked = async () => /captcha|asking for a captcha|limiting requests/i.test(await pageText());

  if (ungranted) {
    console.log("\n== Spotify not allowed yet");
    const before = await pageText();
    check("the detector says Spotify pages need access first", /once you have allowed access/.test(before));
    await shot("0-link-ungranted");
    await evalPanel(
      `(() => { const i = document.querySelector('#link'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'); i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('form').requestSubmit(); })()`,
    );
    await sleep(800);
    const text = await pageText();
    console.log(text.split("\n").slice(0, 16).join(" | "));
    check("the explanation shows before Chrome is asked", /Allow Géniescraper to read Spotify pages\?/.test(text));
    check(
      "nothing was loaded from Spotify",
      (await browser.targets()).every((t) => !/open\.spotify\.com/.test(t.url)),
    );
    await shot("0-access-card");
    await evalPanel("document.querySelector('[data-key=access-decline]').click()");
    await sleep(500);
    check("Not now closes the explanation", !/Allow Géniescraper to read/.test(await pageText()));
    await shot("0-after-decline");
  }

  if (wantNoAccessTab) {
    console.log("\n== open Spotify tab, access not granted");
    const spotifyTab = await browser.openTab(`https://open.spotify.com/album/${albumId || "4yP0hdKOZPNshxUOjY0cZj"}`);
    loads += 1;
    await sleep(6000);
    const seen = await evalPanel(
      "chrome.tabs.query({}).then((tabs) => tabs.filter((t) => (t.url || '').includes('spotify') || (t.title || '').includes('Spotify')).map((t) => ({ url: t.url ?? null, title: t.title ?? null })))",
    );
    console.log("tabs the panel can see: " + JSON.stringify(seen));
    const byPattern = await evalPanel(
      "chrome.tabs.query({ url: ['https://open.spotify.com/*'] }).then((tabs) => tabs.map((t) => ({ url: t.url ?? null, title: t.title ?? null })))",
    );
    console.log("by host pattern: " + JSON.stringify(byPattern));
    await fetch(`http://127.0.0.1:9341/json/close/${spotifyTab.id}`).catch(() => undefined);
    await sleep(800);
  }

  // Phase 1: an album, a few of its tracks.
  if (albumUrl) {
    console.log(`\n== album ${albumId}`);
    const started = Date.now();
    await submitLink(albumUrl);
    const listed = await until(
      "document.querySelectorAll('[data-key^=track-]').length > 0",
      "the album's track list",
      60000,
    );
    check("album track list appears", listed, `${String(Date.now() - started)} ms`);
    const text = await pageText();
    const boxes = await evalPanel("document.querySelectorAll('[data-key^=track-]').length");
    console.log(text.split("\n").slice(0, 12).join(" | "));
    check("album lists tracks", boxes > 1, `${String(boxes)} rows`);
    await shot("1-album-tracks");
    if (listed) {
      const picked = readAll ? boxes : albumTracks;
      if (readAll) await clickKey("all");
      else for (let i = 0; i < albumTracks; i++) await clickKey(`track-${String(i)}`);
      const t0 = Date.now();
      await clickKey("go");
      loads += picked;
      // When each track stops being "Waiting" or "Reading": the first is what the user waits for.
      const doneAt = new Array(picked).fill(null);
      const deadline = Date.now() + 240000;
      while (Date.now() < deadline && doneAt.some((t) => t === null)) {
        const states = await evalPanel(
          `[...document.querySelectorAll('[data-key^=show-]')].map((b) => /Waiting|Reading/.test(b.textContent) ? 0 : 1)`,
        );
        states.forEach((done, i) => {
          if (done && doneAt[i] === null) doneAt[i] = Date.now() - t0;
        });
        await sleep(100);
      }
      const finished = doneAt.filter((t) => t !== null).sort((x, y) => x - y);
      console.log(
        `timing: tracks=${String(picked)} first=${String(finished[0])} ms, last=${String(finished.at(-1))} ms, per track=${String(Math.round((finished.at(-1) ?? 0) / picked))} ms`,
      );
      console.log(`finish times (ms): ${doneAt.join(" ")}`);
      await until("/Got credits for/.test(document.body.innerText)", "the summary line", 10000);
      const after = await pageText();
      console.log(after.split("\n").slice(0, 14).join(" | "));
      check(
        "every picked track was read",
        new RegExp(`Got credits for ${String(picked)} tracks?\\.`).test(after),
        `${String(Date.now() - t0)} ms`,
      );
      await shot("2-album-review");
      await clickKey("show-0").catch(() => undefined);
      await sleep(500);
      console.log((await pageText()).split("\n").slice(0, 40).join("\n"));
      await shot("3-album-track-open");
    }
    await clickKey("menu").catch(() => undefined);
    await sleep(500);
    if (await blocked()) throw new Error("Spotify showed a captcha or limit: stopping.");
  }

  // Phase 2: single tracks, each through detect and then the track's own read.
  for (const id of trackIds) {
    console.log(`\n== track ${id}`);
    const t0 = Date.now();
    await submitLink(`https://open.spotify.com/track/${id}`);
    loads += 1; // the credits read is a second page load
    await until(
      "/Got credits for|could not|Could not|unavailable|No playable/.test(document.body.innerText)",
      "the track read",
      90000,
    );
    const text = await pageText();
    console.log(text.split("\n").slice(0, 45).join("\n"));
    check(`track ${id} was read`, /Got credits for 1 track/.test(text), `${String(Date.now() - t0)} ms`);
    check(`track ${id} says what Spotify cannot give`, /ISRC/.test(text));
    await shot(`4-track-${id}`);
    await clickKey("menu").catch(() => undefined);
    await evalPanel(
      "[...document.querySelectorAll('button')].find((b) => /Back to main menu/.test(b.textContent))?.click()",
    );
    await sleep(800);
    if (await blocked()) throw new Error("Spotify showed a captcha or limit: stopping.");
  }

  // Phase 3: a track that does not exist.
  if (wantUnavailable) {
    console.log("\n== unavailable track");
    await submitLink("https://open.spotify.com/track/1111111111111111111111");
    await until(
      "/Spotify has no playable page|could not|Could not/.test(document.body.innerText)",
      "the unavailable answer",
      60000,
    );
    const text = await pageText();
    check(
      "an unavailable track says so",
      /no playable page/.test(text),
      text.split("\n").find((l) => /playable|Could not/.test(l)) ?? "",
    );
    await shot("5-unavailable");
  }

  // Phase 3b: Spotify rewrites a tab's title to the song that is playing; the card must still name the page itself.
  if (wantDetector) {
    console.log("\n== detector with a different song playing");
    const spotifyTab = await browser.openTab(`https://open.spotify.com/album/${albumId || "4yP0hdKOZPNshxUOjY0cZj"}`);
    loads += 1;
    await sleep(6000);
    const tabSession = await connect(spotifyTab.webSocketDebuggerUrl);
    await tabSession.evaluate("document.title = 'Race My Mind - song and lyrics by Drake | Spotify'");
    const tabTitle = await tabSession.evaluate("document.title");
    if (wantSpa) {
      const read = async (label) => {
        const t = await pageText();
        console.log(
          label +
            ": " +
            t
              .split("\n")
              .slice(0, 16)
              .join(" | ")
              .replace(/^.*Pick one to get its credits\. \| /, ""),
        );
      };
      await sleep(2500);
      await read("before moving, panel left open");
      await tabSession.evaluate("document.querySelector(\"a[data-testid='internal-track-link']\")?.click()");
      await tabSession.evaluate("setTimeout(() => { document.title = 'Race My Mind • Drake'; }, 400)");
      await sleep(1800);
      await read("1.8 s after moving inside the player");
      await sleep(8000);
      await read("9.8 s after moving");
      console.log("tab url now: " + (await tabSession.evaluate("location.pathname")));
    }
    tabSession.close?.();
    await evalPanel("location.reload()");
    await sleep(2500);
    const text = await pageText();
    console.log("tab title: " + tabTitle);
    console.log(text.split("\n").slice(0, 16).join(" | "));
    check("the tab title was rewritten to another song", /Race My Mind/.test(tabTitle));
    check(
      "the card names the page itself, not a generic name",
      / - /.test(text.split("Pick one to get its credits.")[1] ?? "") &&
        !/Spotify (album|track)\b/.test(
          (text.split("Pick one to get its credits.")[1] ?? "").split("Get credits")[0] ?? "",
        ),
    );
    check("the card never shows the playing song", !/Race My Mind|Drake/.test(text));
    await shot("7-detector-playing-elsewhere");
    await fetch(`http://127.0.0.1:9341/json/close/${spotifyTab.id}`).catch(() => undefined);
    await sleep(800);
  }

  // Phase 3c: Apple Music tabs next to the Spotify card: same "Artist - Title" format, and a song picked inside an
  // album address (?i=) is a Song. The panel stays open: the list must update by itself, with no tab switch.
  if (args.includes("--apple-tabs")) {
    console.log("\n== Apple Music tabs");
    const opened = [];
    for (const url of [
      "https://music.apple.com/us/album/lonely-at-the-top/1835726721?i=1835726995",
      "https://music.apple.com/us/album/lonely-at-the-top/1835726721",
      "https://music.apple.com/us/song/lonely-at-the-top/1835726995",
    ]) {
      opened.push(await browser.openTab(url));
      await sleep(4500);
    }
    await sleep(1500);
    const text = await pageText();
    console.log(text.split("\n").slice(0, 24).join(" | "));
    const flat = text.split("\n").join(" | ");
    check(
      "the album address with a song picked is the Album, named by the album",
      /Joey Bada\$\$ - Lonely At The Top \| Apple Music . Album/.test(flat),
    );
    check("the real song page is a Song", /Apple Music . Song/.test(flat));
    check("no marketing text in any name", !/with Lyrics|Song by|Album by/.test(text));
    await shot("8-apple-tabs");
    for (const t of opened) await fetch(`http://127.0.0.1:9341/json/close/${t.id}`).catch(() => undefined);
    await sleep(800);
  }

  // Phase 4: a Spotify tab the user already has open shows up in the open-pages list.
  if (wantTab) {
    console.log("\n== open Spotify tab");
    const spotifyTab = await browser.openTab(
      `https://open.spotify.com/track/${trackIds[0] ?? "0VjIjW4GlUZAMYd2vXMi3b"}`,
    );
    loads += 1;
    await sleep(6000);
    await evalPanel("location.reload()");
    await sleep(2000);
    const text = await pageText();
    console.log(text.split("\n").slice(0, 14).join(" | "));
    check("the open Spotify tab is listed with its source", /Spotify · Song/.test(text));
    await shot("6-open-tab");
    await fetch(`http://127.0.0.1:9341/json/close/${spotifyTab.id}`).catch(() => undefined);
  }

  await sleep(1000);
  const leftover = (await browser.targets()).filter((t) => t.type === "page" && /open\.spotify\.com/.test(t.url));
  check("no Spotify tab is left open", leftover.length === 0, `${String(leftover.length)} left`);
  console.log(`\nSpotify page loads this run: about ${String(loads)}`);
} catch (error) {
  console.error(error);
  failures.push(String(error));
} finally {
  panel?.close?.();
  await browser.stop();
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(failures.length === 0 ? 0 : 1);
