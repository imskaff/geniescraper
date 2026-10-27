// Opt-in live acceptance check of the whole extension: it drives the real side-panel page against the real
// service worker and live Apple Music, and checks what a user would see. Hidden tabs do the reading.
//
//   npm run build
//   node scripts/live-panel.mjs --chrome <chrome.exe> [--screenshots <folder>]
//
// Exit code 0 only when every step passed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findServiceWorker, launchChromium, sleep } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const shotsDir = option("--screenshots", "");
if (!chromePath) throw new Error("Pass --chrome <path to a Chromium or Chrome executable> (or set CHROME_PATH).");

const golden = JSON.parse(readFileSync(join(root, "..", "tests", "golden", "eilish-hmhas-t3.json"), "utf-8"));
const ALBUM_URL = "https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134";
const TRACK_NUMBER = 3;

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

const browser = launchChromium({ chromePath, dist: join(root, "dist"), port: 9335 });
let worker;
let panel;
try {
  const workerTarget = await findServiceWorker(browser);
  worker = await connect(workerTarget.webSocketDebuggerUrl);
  const extensionId = new URL(workerTarget.url).host;

  // The toolbar button must open the side panel.
  // The worker target can be listed a moment before its JavaScript context is ready, so retry briefly.
  let behavior;
  for (let attempt = 0; attempt < 25 && !behavior; attempt++) {
    behavior = await worker.evaluate("chrome.sidePanel.getPanelBehavior()").catch(() => undefined);
    if (!behavior) await sleep(200);
  }
  behavior ??= {};
  check("toolbar button opens the side panel", behavior.openPanelOnActionClick === true);

  // The panel page is opened as a tab here, because a side panel cannot be opened from outside the browser.
  const tab = await browser.openTab(`chrome-extension://${extensionId}/ui/panel.html`);
  panel = await connect(tab.webSocketDebuggerUrl);
  await panel.send("Emulation.setDeviceMetricsOverride", {
    width: 400,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const text = (selector) => panel.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const waitFor = async (expression, what, ms = 30000) => {
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

  await waitFor("!!document.querySelector('#link')", "the link screen");
  check("panel opens on the link screen", (await text("h2")) === "Get credits from Apple Music");
  check("focus starts on the heading", await panel.evaluate("document.activeElement?.tagName === 'H2'"));
  await shot("1-link");

  // Link -> track list: a hidden background tab reads the album through the real worker.
  await panel.evaluate(`(() => {
    const input = document.querySelector('#link');
    input.value = ${JSON.stringify(ALBUM_URL)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`);
  await waitFor("document.querySelector('h2')?.textContent === 'HIT ME HARD AND SOFT'", "the track list");
  const boxes = await panel.evaluate(
    "[...document.querySelectorAll('input[type=checkbox]')].map((b) => [b.checked, b.disabled])",
  );
  check("track list shows 11 tracks", boxes.length === 11, String(boxes.length));
  check(
    "exactly the track Apple gives no page is disabled and unpicked",
    boxes.filter(([, disabled]) => disabled).length === 1 && boxes.filter(([checked]) => checked).length === 10,
  );
  check("focus moved to the track list heading", await panel.evaluate("document.activeElement?.tagName === 'H2'"));
  await shot("2-tracks");

  // Pick one track and read it.
  await clickButton("Select none");
  await click(`[data-key="track-${String(TRACK_NUMBER - 1)}"]`);
  await clickButton("Get credits for 1 track");
  await waitFor("document.querySelector('h2')?.textContent === 'Credits'", "the review screen");
  await waitFor("[...document.querySelectorAll('dt')].some((dt) => dt.textContent === 'Songwriter')", "the credits");
  await shot("3-review");

  const overflow = await panel.evaluate(`(() => {
    const root = document.documentElement;
    const wide = [...document.querySelectorAll('body *')]
      .filter((node) => node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0)
      .map((node) => node.tagName.toLowerCase() + '.' + node.className + ' scroll=' + node.scrollWidth + ' client=' + node.clientWidth)
      .slice(0, 5);
    return { scroll: root.scrollWidth, client: root.clientWidth, body: document.body.scrollWidth, wide };
  })()`);
  check(
    "the credits screen has no horizontal scrollbar at panel width",
    overflow.scroll <= overflow.client,
    `scroll ${String(overflow.scroll)} vs client ${String(overflow.client)}, body ${String(overflow.body)}; ${overflow.wide.join("; ")}`,
  );
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
  check("status is announced", (await text("#status")) === "Got credits for 1 track.", String(await text("#status")));

  // The reads must not leave tabs behind.
  await sleep(1000);
  const leftovers = (await browser.targets()).filter((t) => t.type === "page" && t.url.includes("music.apple.com"));
  check("no Apple Music tab is left open", leftovers.length === 0, leftovers.map((t) => t.url).join(", "));

  // Settings take effect at once, without reading again.
  await clickButton("Settings");
  await waitFor("document.querySelector('h2')?.textContent === 'Settings'", "settings");
  await shot("4-settings");
  await click('[data-key="setting-scrapeCore"]');
  await clickButton("Back");
  await waitFor("document.querySelector('h2')?.textContent === 'Credits'", "the review screen again");
  const queueAfter = await panel.evaluate(
    "[...document.querySelectorAll('ol.queue li')].map((li) => li.children[0].textContent)",
  );
  check("turning off songwriters and producers removes them from the queue", !queueAfter.includes("Written By"));
  await shot("5-review-after-setting");

  // The session survives the panel closing: reload it and expect the credits back.
  await panel.send("Page.reload");
  await waitFor("!!document.querySelector('h2')", "the reloaded panel");
  await waitFor("document.querySelector('h2')?.textContent === 'Credits'", "the restored review screen", 10000);
  check("reopening the panel restores the credits", (await text("#track-heading")) === golden.title);

  // A bad link is refused in the panel; a missing page is reported in words.
  await clickButton("New link");
  await waitFor("!!document.querySelector('#link')", "a fresh link screen");
  await panel.evaluate(`(() => {
    const input = document.querySelector('#link');
    input.value = 'https://music.apple.com/us/album/does-not-exist/1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`);
  await waitFor("document.querySelector('#alert')?.textContent.length > 0", "the not-found message");
  check(
    "a missing page is reported in words",
    (await text("#alert"))?.startsWith("Apple Music could not find that page"),
    String(await text("#alert")),
  );
  await shot("6-error");
} finally {
  panel?.close();
  worker?.close();
  await browser.stop();
}

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${String(failures.length)} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
