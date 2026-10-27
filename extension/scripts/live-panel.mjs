// Opt-in live acceptance check of the whole extension: it drives the real side-panel page against the real
// service worker and live Apple Music, and checks what a user would see. Hidden tabs do the reading.
// The first half is keyboard-only (real key events, no synthetic clicks), so focus order is part of the proof.
//
//   npm run build
//   node scripts/live-panel.mjs --chrome <chrome.exe> [--screenshots <folder>]
//
// It reads a whole 10-track album, like one normal run of the desktop app. Exit code 0 only when every step passed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findServiceWorker, launchChromium, sleep, waitUntilReady } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const shotsDir = option("--screenshots", "");
if (!chromePath) throw new Error("Pass --chrome <path to a Chromium or Chrome executable> (or set CHROME_PATH).");

const golden = JSON.parse(readFileSync(join(root, "..", "tests", "golden", "eilish-hmhas-t3.json"), "utf-8"));
const ALBUM_URL = "https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134";
const TRACK_INDEX = 2; // zero-based: CHIHIRO, the golden track

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

const KEYS = {
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
};

const browser = launchChromium({ chromePath, dist: join(root, "dist"), port: 9335 });
let worker;
let panel;
try {
  const workerTarget = await findServiceWorker(browser);
  worker = await connect(workerTarget.webSocketDebuggerUrl);
  await waitUntilReady(worker);
  const extensionId = new URL(workerTarget.url).host;

  // The toolbar button must open the side panel.
  const behavior = await worker.evaluate("chrome.sidePanel.getPanelBehavior()");
  check("toolbar button opens the side panel", behavior.openPanelOnActionClick === true);

  // The panel page is opened as a tab here (the real side panel is exercised by live-sidepanel.mjs), so the
  // active tab is the panel itself and the album is read through a hidden tab.
  const tab = await browser.openTab(`chrome-extension://${extensionId}/ui/panel.html`);
  panel = await connect(tab.webSocketDebuggerUrl);
  const setWidth = (width) =>
    panel.send("Emulation.setDeviceMetricsOverride", { width, height: 760, deviceScaleFactor: 1, mobile: false });
  await setWidth(400);

  const text = (selector) => panel.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const until = async (expression, what, ms = 30000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await panel.evaluate(expression)) return true;
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
  const click = (selector) => panel.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const clickButton = (label) =>
    panel.evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click()`,
    );
  const focused = () =>
    panel.evaluate(
      "document.activeElement?.getAttribute('data-key') || document.activeElement?.id || document.activeElement?.tagName",
    );
  /** A real key press through the browser's input pipeline. */
  const press = async (name) => {
    await panel.send("Input.dispatchKeyEvent", { type: "keyDown", ...KEYS[name] });
    await panel.send("Input.dispatchKeyEvent", { type: "keyUp", ...KEYS[name] });
    await sleep(60);
  };
  const horizontalOverflow = () =>
    panel.evaluate(`(() => {
      const root = document.documentElement;
      const wide = [...document.querySelectorAll('body *')]
        .filter((node) => node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0)
        .map((node) => node.tagName.toLowerCase() + '.' + node.className + ' scroll=' + node.scrollWidth + ' client=' + node.clientWidth)
        .slice(0, 5);
      return { scroll: root.scrollWidth, client: root.clientWidth, wide };
    })()`);
  const checked = (key) => panel.evaluate(`document.querySelector('[data-key="${key}"]').checked`);

  await until("!!document.querySelector('#link')", "the link screen");
  check("panel opens on the link screen", (await text("h2")) === "Get credits from Apple Music");
  check("focus starts on the heading", (await focused()) === "H2");
  await shot("1-link");

  // ── keyboard only: link box, Enter, track list, Space, Tab to the button, Enter ──
  await press("Tab");
  check("Tab from the heading reaches the link box", (await focused()) === "link", String(await focused()));
  await panel.send("Input.insertText", { text: ALBUM_URL });
  await press("Enter");
  await until("document.querySelector('h2')?.textContent === 'HIT ME HARD AND SOFT'", "the track list");
  check("Enter in the link box reads the album", (await text("h2")) === "HIT ME HARD AND SOFT");
  check("focus moved to the track list heading", (await focused()) === "H2");
  const boxes = await panel.evaluate(
    "[...document.querySelectorAll('input[type=checkbox]')].map((b) => [b.checked, b.disabled])",
  );
  check("track list shows 11 tracks", boxes.length === 11, String(boxes.length));
  check(
    "exactly the track Apple gives no page is disabled and unpicked",
    boxes.filter(([, disabled]) => disabled).length === 1 && boxes.filter(([isOn]) => isOn).length === 10,
  );
  await shot("2-tracks");

  const order = [];
  for (let i = 0; i < 3; i++) {
    await press("Tab");
    order.push(await focused());
  }
  check(
    "Tab visits Select all, Select none, then the first track",
    order.join(",") === "all,none,track-0",
    order.join(","),
  );
  await press("Space");
  check("Space unpicks the focused track", (await checked("track-0")) === false);
  check("focus stays on the checkbox after it changes", (await focused()) === "track-0", String(await focused()));
  await press("Space");
  check("Space picks it again", (await checked("track-0")) === true);

  let reached = false;
  for (let i = 0; i < 20 && !reached; i++) {
    await press("Tab");
    reached = (await focused()) === "go";
  }
  check("Tab reaches the Get credits button, skipping the disabled track", reached);
  check(
    "the button says how many tracks it will read",
    (await text('[data-key="go"]')) === "Get credits for 10 tracks",
  );
  await shot("2b-focus-ring-on-button");
  await press("Enter");

  await until("document.querySelector('h2')?.textContent === 'Credits'", "the review screen");
  check("Enter on the button moves to the credits", (await text("h2")) === "Credits");
  await until(
    "document.querySelector('#status')?.textContent === 'Got credits for 10 tracks.'",
    "all 10 tracks",
    90000,
  );
  check(
    "all ten tracks were read, one after another",
    (await text("#status")) === "Got credits for 10 tracks.",
    String(await text("#status")),
  );
  await shot("3-review-first-track");

  // ── the golden track ──
  await click(`[data-key="show-${String(TRACK_INDEX)}"]`);
  await until("document.querySelector('#track-heading')?.textContent === 'CHIHIRO'", "the golden track");
  const overflow = await horizontalOverflow();
  check(
    "the credits screen has no horizontal scrollbar at 400 px",
    overflow.scroll <= overflow.client,
    `scroll ${String(overflow.scroll)} vs client ${String(overflow.client)}; ${overflow.wide.join("; ")}`,
  );
  await shot("4-review-golden-track");

  const credits = await panel.evaluate(`Object.fromEntries(
    [...document.querySelectorAll('dl.credits dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]))`);
  const wanted = {};
  for (const { role, artists } of golden.credits) wanted[role] = [...new Set([...(wanted[role] ?? []), ...artists])];
  const roleMismatch = Object.keys(wanted).filter(
    (role) => [...(credits[role] ?? "").split(", ")].sort().join("|") !== [...wanted[role]].sort().join("|"),
  );
  check("credits match the golden file", roleMismatch.length === 0, roleMismatch.join(", "));
  check(
    "album copyright is shown",
    credits["Phonographic copyright"] === golden.phonographic_copyright,
    String(credits["Phonographic copyright"]),
  );
  check("track heading is the golden title", (await text("#track-heading")) === golden.title);
  const queue = await panel.evaluate(
    "[...document.querySelectorAll('ol.queue li')].map((li) => li.children[0].textContent + ': ' + li.children[1].textContent)",
  );
  check("paste queue starts with Written By", queue[0]?.startsWith("Written By: "), queue[0]);
  check(
    "paste queue includes the copyright label",
    queue.some((q) => q.startsWith("℗ label: ")),
  );
  console.log(`      queue has ${String(queue.length)} steps`);

  // The reads must not leave tabs behind.
  await sleep(1000);
  const leftovers = (await browser.targets()).filter((t) => t.type === "page" && t.url.includes("music.apple.com"));
  check("no Apple Music tab is left open", leftovers.length === 0, leftovers.map((t) => t.url).join(", "));

  // ── settings, and both color schemes ──
  await clickButton("Settings");
  await until("document.querySelector('h2')?.textContent === 'Settings'", "settings");
  await shot("5-settings-dark");
  await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await sleep(300);
  await shot("5-settings-light");
  await click('[data-key="setting-scrapeCore"]');
  await clickButton("Back");
  await until("document.querySelector('h2')?.textContent === 'Credits'", "the review screen again");
  await shot("6-review-light");
  await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  const queueAfter = await panel.evaluate(
    "[...document.querySelectorAll('ol.queue li')].map((li) => li.children[0].textContent)",
  );
  check("turning off songwriters and producers removes them from the queue", !queueAfter.includes("Written By"));

  // ── the narrowest a side panel can be ──
  await setWidth(320);
  await sleep(300);
  const narrow = await horizontalOverflow();
  check(
    "the credits screen has no horizontal scrollbar at 320 px",
    narrow.scroll <= narrow.client,
    `scroll ${String(narrow.scroll)} vs client ${String(narrow.client)}; ${narrow.wide.join("; ")}`,
  );
  await shot("7-review-320px");
  await setWidth(400);

  // ── the session survives the panel closing ──
  await panel.send("Page.reload");
  await until("!!document.querySelector('h2')", "the reloaded panel");
  await until("document.querySelector('h2')?.textContent === 'Credits'", "the restored review screen", 10000);
  check(
    "reopening the panel restores the credits",
    (await text("h2")) === "Credits" && (await text("#track-heading")) !== null,
  );

  // ── a missing page is reported in words ──
  await clickButton("New link");
  await until("!!document.querySelector('#link')", "a fresh link screen");
  check(
    "New link starts with an empty link box",
    (await panel.evaluate("document.querySelector('#link').value")) === "",
  );
  await panel.evaluate(`(() => {
    const input = document.querySelector('#link');
    input.value = 'https://music.apple.com/us/album/does-not-exist/1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`);
  await until("document.querySelector('#alert')?.textContent.length > 0", "the not-found message");
  check(
    "a missing page is reported in words",
    (await text("#alert"))?.startsWith("Apple Music could not find that page"),
    String(await text("#alert")),
  );
  await shot("8-error");
} finally {
  panel?.close();
  worker?.close();
  await browser.stop();
}

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${String(failures.length)} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
