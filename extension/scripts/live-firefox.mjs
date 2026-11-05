// Opt-in live check of the Firefox build in a real Firefox, run unattended: headless, a throwaway profile, and no
// use of the desktop's mouse or keyboard (a full-screen game on the same machine is left alone). It drives Firefox
// over Marionette (scripts/lib/marionette.mjs).
//
//   npm run build:firefox
//   node scripts/live-firefox.mjs [--firefox <firefox.exe>] [--no-spotify] [--no-genius]
//        [--apple-album <url>] [--spotify-album <url>]
//
// It reads one Apple Music album and one Spotify album through the panel page served from dist-firefox, one read at
// a time (a few page loads in all), and opens one Genius page. Run it sparingly, never in a loop.
//
// What it proves: the add-on installs, its panel renders (in a tab and as the sidebar), an album is detected and one
// track read for each service, the hidden reader windows open minimized and close again, the Spotify guard is armed
// and no playback starts, and a key on a Genius page reaches the content script (F9, the Firefox default next key, and
// F8, its default back key). F7 is not checked: a headless Firefox hands it to the page, a normal one keeps it for caret browsing).
// What it cannot prove: a real click on the toolbar button (the browser chrome is not clicked here).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { clearTimeout } from "node:timers";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_UUID, launchFirefox, sleep } from "./lib/marionette.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const firefoxPath =
  option("--firefox", process.env["FIREFOX_PATH"]) ??
  [
    "C:/Program Files/Mozilla Firefox/firefox.exe",
    "/Applications/Firefox.app/Contents/MacOS/firefox",
    "/usr/bin/firefox",
  ].find((path) => existsSync(path));
if (!firefoxPath) throw new Error("Pass --firefox <path to Firefox 140 or newer> (or set FIREFOX_PATH).");
const golden = JSON.parse(readFileSync(join(root, "..", "tests", "golden", "eilish-hmhas-t3.json"), "utf-8"));
const APPLE_ALBUM = option("--apple-album", golden.apple_music_url);
const SPOTIFY_ALBUM = option("--spotify-album", "https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj");
const GENIUS_PAGE = "https://genius.com/Billie-eilish-chihiro-lyrics";

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

execFileSync(process.execPath, [join(root, "scripts", "build.mjs"), "--firefox"], { cwd: root, stdio: "ignore" });
const ff = await launchFirefox({ firefoxPath });
const hardStop = setTimeout(async () => {
  console.log("FAIL  timed out after 6 minutes");
  await ff.stop();
  process.exit(1);
}, 360_000);

const cmd = (name, params) => ff.command(name, params);
await cmd("WebDriver:SetTimeouts", { script: 120_000, pageLoad: 60_000 });
const setContext = (value) => cmd("Marionette:SetContext", { value });
const inChrome = async (script) => {
  await setContext("chrome");
  try {
    return (await cmd("WebDriver:ExecuteAsyncScript", { script, args: [] })).value;
  } finally {
    await setContext("content");
  }
};
const handles = () => cmd("WebDriver:GetWindowHandles");
const switchTo = (handle) => cmd("WebDriver:SwitchToWindow", { handle });
/** Run an async body in the selected page. `chrome` is the page's extension API; the body returns JSON data. */
const inPage = async (body) => {
  const script = `const done = arguments[arguments.length - 1];
    const chrome = window.wrappedJSObject?.chrome ?? window.chrome;
    (async () => { ${body} })().then((v) => done(JSON.stringify(v ?? null)), (e) => done(JSON.stringify({ error: String(e) })));`;
  const { value } = await cmd("WebDriver:ExecuteAsyncScript", { script, args: [] });
  return JSON.parse(value);
};
const text = () => inPage("return document.body.innerText;");
const until = async (what, probe, ms = 30_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => null);
    if (value) return value;
    await sleep(300);
  }
  check(`waited for ${what}`, false, "timed out");
  return null;
};
const KEYS = { F7: "\uE037", F8: "\uE038", F9: "\uE039" };
const pressKey = async (name) => {
  const value = KEYS[name];
  await cmd("WebDriver:PerformActions", {
    actions: [
      {
        type: "key",
        id: "keyboard",
        actions: [
          { type: "keyDown", value },
          { type: "keyUp", value },
        ],
      },
    ],
  });
  await cmd("WebDriver:ReleaseActions");
};

try {
  const version = await inChrome("const done = arguments[arguments.length - 1]; done(Services.appinfo.version);");
  console.log(`Firefox ${String(version)}, headless, throwaway profile`);
  check("Firefox is 140 or newer", Number.parseInt(String(version), 10) >= 140, String(version));

  const installed = await cmd("Addon:Install", { path: join(root, "dist-firefox"), temporary: true });
  check("the Firefox build installs", installed.value === "geniescraper@imskaff", String(installed.value));
  await sleep(1500);

  // The panel page, opened in a tab (WebDriver cannot navigate to moz-extension:// itself, the browser can).
  const first = (await handles())[0];
  await inChrome(
    `const done = arguments[arguments.length - 1];
     gBrowser.selectedTab = gBrowser.addTab("moz-extension://${EXTENSION_UUID}/ui/panel.html", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
     done(true);`,
  );
  const panel = await until("the panel tab", async () => (await handles()).find((h) => h !== first));
  await switchTo(panel);
  await until("the panel to render", async () => /Géniescraper/.test(await text()));
  // A fresh profile starts with the first-time set-up; this check is about reading and pasting, so mark it done.
  await inPage("await chrome.storage.sync.set({ settings: { onboarded: true } });");
  await cmd("WebDriver:Refresh");
  await until("the link screen", async () => inPage("return !!document.querySelector('#link');"));
  check("the panel renders from the Firefox build", /Géniescraper/.test(await text()));
  const info = await inPage(
    "return { sidebar: typeof chrome.sidebarAction, sidePanel: typeof chrome.sidePanel, promise: typeof chrome.storage.local.get('x').then === 'function' };",
  );
  check(
    "Firefox API surface: sidebarAction yes, sidePanel no, promises",
    info.sidebar === "object" && info.sidePanel === "undefined" && info.promise,
    JSON.stringify(info),
  );

  // The sidebar: opened through the browser's own sidebar controller (a real toolbar click is not made here).
  const sidebarId = "geniescraper_imskaff-sidebar-action";
  const shown = await inChrome(
    `const done = arguments[arguments.length - 1];
     SidebarController.show("${sidebarId}").then(async () => {
       for (let i = 0; i < 50; i++) {
         const inner = SidebarController.browser.contentDocument?.getElementById("webext-panels-browser");
         if (inner?.currentURI?.spec.endsWith("/ui/panel.html")) break;
         await new Promise((r) => setTimeout(r, 100));
       }
       const inner = SidebarController.browser.contentDocument?.getElementById("webext-panels-browser");
       done({ id: SidebarController.currentID, url: inner?.currentURI?.spec ?? null });
     }, (e) => done({ error: String(e) }));`,
  );
  check(
    "the sidebar opens and shows the panel page",
    shown?.id === sidebarId && String(shown.url).endsWith("/ui/panel.html"),
    JSON.stringify(shown),
  );

  // One read of a service: submit the link in the real form, pick a track, read it, and watch the reader windows.
  const readAlbum = async (name, url) => {
    console.log(`\n== ${name}: ${url}`);
    await switchTo(panel);
    await inPage(
      `const link = document.querySelector('#link'); link.value = ${JSON.stringify(url)};
       link.dispatchEvent(new Event('input', { bubbles: true }));
       document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));`,
    );
    const listed = await until(
      `${name} tracks`,
      async () => inPage("return document.querySelectorAll('[data-key^=track-]').length;"),
      90_000,
    );
    check(`${name}: the album is detected and its tracks listed`, Number(listed) > 2, `${String(listed)} tracks`);
    if (!listed) return;
    await inPage("document.querySelector('[data-key=track-2]').click();");
    await inPage("document.querySelector('[data-key=go]').click();");

    // Poll the browser's windows while the read runs: the reader must be minimized, and must be gone at the end.
    const seen = { windows: 0, minimized: false, urls: new Set(), guard: null, playing: 0 };
    const deadline = Date.now() + 120_000;
    let summary = false;
    while (Date.now() < deadline && !summary) {
      const now = await inPage(
        `const wins = await chrome.windows.getAll({ populate: true });
         const out = [];
         for (const w of wins) for (const t of w.tabs ?? []) if (/music\\.apple\\.com|open\\.spotify\\.com/.test(t.url ?? "")) {
           let probe = null;
           if (/open\\.spotify\\.com/.test(t.url) && t.status === "complete") {
             try {
               const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, world: "MAIN", func: () => ({
                 guarded: String(HTMLMediaElement.prototype.play).includes("Playback is off") || String(HTMLMediaElement.prototype.play).includes("NOT_ALLOWED"),
                 playing: [...document.querySelectorAll("audio,video")].filter((m) => !m.paused && !m.ended).length,
                 session: navigator.mediaSession ? navigator.mediaSession.playbackState : "none" }) });
               probe = r.result;
             } catch { probe = null; }
           }
           out.push({ state: w.state, url: t.url, probe });
         }
         return { out, body: document.body.innerText };`,
      );
      for (const item of now.out) {
        seen.windows = Math.max(seen.windows, now.out.length);
        seen.urls.add(item.url.replace(/\?.*/, ""));
        if (item.state === "minimized") seen.minimized = true;
        if (item.probe) {
          seen.guard = item.probe.guarded;
          seen.playing += item.probe.playing + (item.probe.session === "playing" ? 1 : 0);
        }
      }
      summary = /Got credits for 1 track/.test(now.body);
      if (!summary) await sleep(150);
    }
    check(`${name}: one track was read and the credits shown`, summary);
    check(
      `${name}: a reader window opened (minimized) while reading`,
      seen.windows > 0 && seen.minimized,
      [...seen.urls].join(", "),
    );
    await sleep(1500);
    const left = await inPage(
      `const wins = await chrome.windows.getAll({ populate: true });
       return wins.flatMap((w) => w.tabs ?? []).filter((t) => /music\\.apple\\.com|open\\.spotify\\.com/.test(t.url ?? "")).length;`,
    );
    check(`${name}: no reader window is left open`, left === 0, String(left));
    if (name === "Spotify") {
      check("Spotify: the page-world guard was in place on the reader page", seen.guard === true, String(seen.guard));
      check("Spotify: no playback started", seen.playing === 0, String(seen.playing));
    }
    await inPage(
      "[...document.querySelectorAll('button')].find((b) => /Back to main menu/.test(b.textContent))?.click();",
    );
    await sleep(500);
  };
  await readAlbum("Apple Music", APPLE_ALBUM);
  if (!args.includes("--no-spotify")) {
    await readAlbum("Spotify", SPOTIFY_ALBUM);
    const after = await inPage("return (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);");
    check(
      "the Spotify guard script is registered",
      after.some((id) => String(id).startsWith("guard:")),
      JSON.stringify(after),
    );
  }

  if (!args.includes("--no-genius")) {
    console.log(`\n== Genius hotkeys: ${GENIUS_PAGE}`);
    await switchTo(panel);
    const created = await cmd("WebDriver:NewWindow", { type: "tab" });
    await switchTo(created.handle);
    await cmd("WebDriver:Navigate", { url: GENIUS_PAGE });
    await sleep(3000);
    // A paste session makes the content script active (the worker tells every Genius tab).
    await switchTo(panel);
    const started = await inPage(
      `return await chrome.runtime.sendMessage({ type: "paste-start", title: "Firefox check", queue: [["written_by", "x"]] });`,
    );
    check("a paste session starts", started?.ok === true, JSON.stringify(started)?.slice(0, 120));
    await switchTo(created.handle);
    await cmd("WebDriver:ExecuteScript", {
      script: `window.__keys = []; window.addEventListener("keydown", (e) => window.__keys.push([e.key, e.defaultPrevented]), true);`,
      args: [],
    });
    for (const key of ["F9", "F8", "F7"]) {
      await pressKey(key);
      await sleep(400);
    }
    const keys = (await cmd("WebDriver:ExecuteScript", { script: "return JSON.stringify(window.__keys);", args: [] }))
      .value;
    const pressed = JSON.parse(keys);
    const prevented = (name) => pressed.find(([key]) => key === name)?.[1] ?? null;
    check(
      "Genius: the content script took F9, the Firefox default next key",
      prevented("F9") === true,
      JSON.stringify(pressed),
    );
    check("Genius: the content script took F8, the Firefox default back key", prevented("F8") === true);
    await switchTo(panel);
    await inPage(`await chrome.runtime.sendMessage({ type: "paste-stop" });`);
  }
} catch (error) {
  check("the run finished without an error", false, String(error instanceof Error ? error.message : error));
} finally {
  clearTimeout(hardStop);
  await ff.stop();
}

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${String(failures.length)} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
