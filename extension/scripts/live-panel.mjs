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
    "nothing is picked for the user, and exactly the track Apple gives no page is disabled",
    boxes.filter(([, disabled]) => disabled).length === 1 && boxes.filter(([isOn]) => isOn).length === 0,
  );
  const style = (selector, prop) =>
    panel.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).${prop}`);
  check(
    "Select all is highlighted yellow, the same as Get credits",
    (await style('[data-key="all"]', "backgroundColor")) === (await style('[data-key="go"]', "backgroundColor")) &&
      (await style('[data-key="all"]', "backgroundColor")) !== (await style('[data-key="none"]', "backgroundColor")),
  );
  check(
    "Get credits is disabled until something is picked",
    await panel.evaluate("document.querySelector('[data-key=go]').disabled"),
  );
  check(
    "Back to main menu is at the bottom of the track list, not in the header",
    await panel.evaluate(
      "document.querySelector('main [data-key=menu]')?.textContent === 'Back to main menu' && !document.querySelector('header').textContent.includes('Back to main menu')",
    ),
  );
  await shot("2-tracks");

  await press("Tab");
  check("Tab reaches Select all first", (await focused()) === "all", String(await focused()));
  await press("Enter");
  const afterAll = await panel.evaluate(
    "[...document.querySelectorAll('input[type=checkbox]')].filter((b) => b.checked).length",
  );
  check("Enter on Select all picks the ten available tracks", afterAll === 10, String(afterAll));
  check("focus stays on Select all after it is used", (await focused()) === "all", String(await focused()));
  const order = [];
  for (let i = 0; i < 2; i++) {
    await press("Tab");
    order.push(await focused());
  }
  check("Tab then visits Select none and the first track", order.join(",") === "none,track-0", order.join(","));
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

  // ── the header, the glow, the collapsed queue, Genius role names ──
  await panel.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  await sleep(200);
  const top = await panel.evaluate(`(() => {
    const b = document.querySelector('#paste-top');
    const r = b.getBoundingClientRect();
    return { hidden: b.hidden, text: b.textContent, label: b.getAttribute('aria-label'), animation: getComputedStyle(b).animationName,
      inHeader: !!b.closest('header'), nextIsSettings: b.nextElementSibling?.id === 'settings-toggle', top: r.top };
  })()`);
  check(
    "Start pasting is at the top, next to Settings",
    !top.hidden && top.inHeader && top.nextIsSettings && top.top < 80,
    JSON.stringify(top),
  );
  check("Start pasting pulses when motion is allowed", top.animation === "glow", top.animation);
  check(
    "Start pasting has a halo",
    (await style("#paste-top", "boxShadow")) !== "none",
    String(await style("#paste-top", "boxShadow")),
  );
  check("Start pasting names its track for screen readers", top.label === "Start pasting CHIHIRO", String(top.label));
  check(
    "Start pasting is not repeated further down",
    !(await panel.evaluate(
      "[...document.querySelector('main').querySelectorAll('button')].some((b) => b.textContent === 'Start pasting')",
    )),
  );
  check(
    "the main menu button is a different color from Settings",
    (await style('[data-key="menu"]', "color")) !== (await style("#settings-toggle", "color")) &&
      (await style('[data-key="menu"]', "borderColor")) !== (await style("#settings-toggle", "borderColor")),
  );
  check(
    "Back to main menu sits in the same row as Back to tracks, below the paste queue",
    await panel.evaluate(
      "(() => { const menu = document.querySelector('main [data-key=menu]'); const back = document.querySelector('main [data-key=back]'); const queue = document.querySelector('details.disclosure'); return menu.parentElement === back.parentElement && !!(queue.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING); })()",
    ),
  );
  await shot("4a-header-top");
  // The header stays in view: scroll to the bottom and it is still at the top of the window.
  await panel.evaluate("window.scrollTo(0, document.body.scrollHeight)");
  await sleep(300);
  const sticky = await panel.evaluate(
    "(() => { const h = document.querySelector('header').getBoundingClientRect(); const b = document.querySelector('#paste-top').getBoundingClientRect(); return { scrolled: window.scrollY, headerTop: h.top, buttonVisible: b.top >= 0 && b.bottom <= innerHeight }; })()",
  );
  check("the page really scrolled", sticky.scrolled > 50, String(sticky.scrolled));
  check(
    "the header, with Start pasting, stays in view while scrolled",
    Math.abs(sticky.headerTop) < 2 && sticky.buttonVisible,
    JSON.stringify(sticky),
  );
  await shot("4b-header-sticky-scrolled");
  await panel.evaluate("window.scrollTo(0, 0)");

  const queueOpen = () => panel.evaluate("document.querySelector('details.disclosure').open");
  check("the paste queue is collapsed by default", (await queueOpen()) === false);
  check(
    "its heading says how long it is",
    /^Paste queue \(\d+ steps\)$/.test((await text("details.disclosure > summary")) ?? ""),
    String(await text("details.disclosure > summary")),
  );
  await panel.evaluate("document.querySelector('[data-key=details-queue]').focus()");
  await press("Space");
  check("Space on its heading expands it", (await queueOpen()) === true);
  await shot("4c-queue-expanded");
  await press("Space");
  check("Space again collapses it", (await queueOpen()) === false);
  const programmer = await panel.evaluate(
    "[...document.querySelectorAll('ol.queue li')].map((li) => li.textContent).filter((t) => /Programm/.test(t))",
  );
  check(
    "Programming is shown as Programmer, the name Genius uses",
    programmer.length > 0 &&
      programmer.every((t) => t.endsWith("Programmer")) &&
      !programmer.some((t) => t.endsWith("Programming")),
    programmer.join(" | "),
  );

  await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(200);
  check(
    "the pulse stops when the system asks for reduced motion",
    (await style("#paste-top", "animationName")) === "none",
  );
  check("the halo stays, so the button still stands out", (await style("#paste-top", "boxShadow")) !== "none");
  await panel.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });

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
  const artworkKey = (url) => /\/image\/thumb\/(.+)\/[^/]+$/.exec(url)?.[1] ?? "";
  const coverHref = await panel.evaluate("document.querySelector('dl.credits a')?.getAttribute('href') ?? ''");
  check(
    "the cover is the golden artwork, from Apple's own lookup, as a 1000x1000 PNG",
    coverHref.endsWith("/1000x1000bb.png") && artworkKey(coverHref) === artworkKey(golden.cover_art_url),
    coverHref,
  );
  check(
    "the cover link is https and safe to open",
    await panel.evaluate(
      "(() => { const a = document.querySelector('dl.credits a'); return !!a && a.rel === 'noopener noreferrer' && a.href.startsWith('https://'); })()",
    ),
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

  // ── the paste screen (opening it needs no Genius sign-in) ──
  await clickButton("Start pasting");
  await until("document.querySelector('h2')?.textContent === 'Paste into Genius'", "the paste screen");
  check("Start pasting opens the paste screen", (await text("h2")) === "Paste into Genius");
  check("focus moved to the paste heading", (await focused()) === "H2");
  const progress = (await text(".progress")) ?? "";
  const stepCount = Number(progress.match(/of (\d+)/)?.[1] ?? 0);
  check("the progress starts at step 1", /^Step 1 of \d+$/.test(progress), progress);
  check("all steps are open from the start", await panel.evaluate("document.querySelector('details.disclosure').open"));
  check(
    "the current step is filled yellow, like the primary buttons",
    (await style("ol.steps li.here", "backgroundColor")) === (await style('[data-key="fill"]', "backgroundColor")),
    String(await style("ol.steps li.here", "backgroundColor")),
  );
  check(
    "Stop pasting has the style of Back to main menu, not the quiet buttons",
    (await style('[data-key="pstop"]', "color")) !== (await style('[data-key="pskip"]', "color")) &&
      (await style('[data-key="pstop"]', "borderColor")) !== (await style('[data-key="pskip"]', "borderColor")),
  );
  check("the first step is named and shown", Boolean(await text(".step .tag")) && Boolean(await text(".step .value")));
  check(
    "the instruction names the Next key and never asks the user to click",
    /Press F8/.test((await text(".step + p")) ?? "") && !/click/i.test((await text(".step + p")) ?? ""),
  );
  check(
    "Back is disabled at the first step",
    await panel.evaluate(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Back (')).disabled",
    ),
  );
  await shot("9-paste-screen-dark");

  // Keyboard: Tab from the heading reaches Fill next, then Skip (Back is disabled), then Stop pasting.
  const tabOrder = [];
  for (let i = 0; i < 3; i++) {
    await press("Tab");
    tabOrder.push(await focused());
  }
  check(
    "Tab visits Fill next, Skip, Stop pasting (the disabled Back is skipped)",
    tabOrder.join(",") === "fill,pskip,pstop",
    tabOrder.join(","),
  );
  await shot("9b-paste-screen-focus");

  await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await sleep(300);
  await shot("9c-paste-screen-light");
  await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

  // Skip to the last step, which is the long song art URL, and check nothing overflows at 400 and 320 px.
  for (let i = 0; i < stepCount + 2; i++) {
    const text_ = (await text(".progress")) ?? "";
    if (text_ === `Step ${String(stepCount)} of ${String(stepCount)}` || text_ === "All steps done") break;
    await clickButton("Skip");
    await sleep(120);
  }
  const lastValue = (await text(".step .value")) ?? "";
  check("the last step is the long song art URL", lastValue.startsWith("https://"), lastValue.slice(0, 40));
  const pasteOverflow = await horizontalOverflow();
  check(
    "the paste screen has no horizontal scrollbar at 400 px",
    pasteOverflow.scroll <= pasteOverflow.client,
    `scroll ${String(pasteOverflow.scroll)} vs client ${String(pasteOverflow.client)}; ${pasteOverflow.wide.join("; ")}`,
  );
  await setWidth(320);
  await sleep(300);
  const pasteNarrow = await horizontalOverflow();
  check(
    "the paste screen has no horizontal scrollbar at 320 px",
    pasteNarrow.scroll <= pasteNarrow.client,
    `scroll ${String(pasteNarrow.scroll)} vs client ${String(pasteNarrow.client)}; ${pasteNarrow.wide.join("; ")}`,
  );
  await shot("9d-paste-screen-last-step-320px");
  await setWidth(400);

  // Settings, with the new Pasting on Genius fieldset, in both schemes.
  await clickButton("Settings");
  await until("document.querySelector('h2')?.textContent === 'Settings'", "settings over the paste screen");
  check(
    "the pasting settings are there and labelled",
    (await panel.evaluate(
      "[...document.querySelectorAll('select, input[type=number]')].every((c) => document.querySelector('label[for=\"' + c.id + '\"]'))",
    )) === true,
  );
  await shot("9e-settings-pasting-dark");
  await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await sleep(300);
  await shot("9f-settings-pasting-light");
  await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  const settingsOverflow = await horizontalOverflow();
  check("the settings screen has no horizontal scrollbar", settingsOverflow.scroll <= settingsOverflow.client);
  await clickButton("Back");
  await until("document.querySelector('h2')?.textContent === 'Paste into Genius'", "the paste screen again");

  // From the last step, one more step finishes the paste: the screen in front of it says so.
  await clickButton("Skip");
  await until("document.querySelector('h2')?.textContent === 'All credits entered'", "the finished screen");
  check(
    "a success screen replaces the paste screen when the last step is done",
    (await text("h2")) === "All credits entered",
  );
  check(
    "it shows a check mark and tells the user to save on Genius",
    (await text(".done-mark")) === "\u2713" &&
      ((await text(".done")) ?? "").includes("Check the Genius page, then press Save there."),
  );
  check("focus moved to its heading", (await focused()) === "H2");
  check(
    "it is announced",
    ((await text("#status")) ?? "").startsWith("All credits entered"),
    String(await text("#status")),
  );
  const nextLabel = await text('[data-key="pnext"]');
  check(
    "it offers the next track, as the main action",
    /^Paste next track: .+/.test(nextLabel ?? ""),
    String(nextLabel),
  );
  check(
    "it offers the credits, the track list and the main menu",
    await panel.evaluate(
      "['pcredits', 'ptracks', 'pmenu'].every((k) => document.querySelector('[data-key=' + k + ']'))",
    ),
  );
  const doneOverflow = await horizontalOverflow();
  check("the finished screen has no horizontal scrollbar", doneOverflow.scroll <= doneOverflow.client);
  await shot("9g-done-screen");
  await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await sleep(300);
  await shot("9h-done-screen-light");
  await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await clickButton("Back to the credits");
  await until("document.querySelector('h2')?.textContent === 'Credits'", "the credits after finishing");
  check("Back to the credits leaves quietly", (await text("h2")) === "Credits" && (await text("#status")) === "");

  // Stop with the keyboard and land back on the credits.
  await clickButton("Start pasting");
  await until("document.querySelector('h2')?.textContent === 'Paste into Genius'", "the paste screen once more");
  let onStop = false;
  for (let i = 0; i < 8 && !onStop; i++) {
    await press("Tab");
    onStop = (await focused()) === "pstop";
  }
  check("Tab reaches Stop pasting", onStop);
  await press("Enter");
  await until("document.querySelector('h2')?.textContent === 'Credits'", "the credits after stopping");
  check("Enter on Stop pasting returns to the credits", (await text("h2")) === "Credits");
  check("stopping is announced", (await text("#status")) === "Stopped pasting.", String(await text("#status")));

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

  // ── an album whose page header has no usable cover: only the catalog lookup can supply it ──
  const sour = JSON.parse(readFileSync(join(root, "..", "tests", "golden", "rodrigo-sour-t6.json"), "utf-8"));
  const detected = await panel.evaluate(
    `chrome.runtime.sendMessage({ type: 'detect', url: 'https://music.apple.com/us/album/sour/1560734944' })`,
  );
  check("detect succeeds for the album with motion artwork", detected?.ok === true);
  const sourCover = detected?.data?.coverArtUrl ?? "";
  check(
    "its cover comes from the catalog lookup, matching the golden artwork",
    sourCover.endsWith("/1000x1000bb.png") && artworkKey(sourCover) === artworkKey(sour.cover_art_url),
    sourCover,
  );

  // ── a missing page is reported in words ──
  await clickButton("Back to main menu");
  await until("!!document.querySelector('#link')", "a fresh link screen");
  check(
    "Back to main menu starts with an empty link box",
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
