// Throwaway opt-in spike, follow-up to live-spotify.mjs: which ways of opening the signed-out Spotify "View credits"
// dialog work for something an extension can do (content-script events, keyboard, a made-visible tab, a minimised or
// off-screen window), and are the credits also present without a click? No extension, no login, no credentials, one
// page at a time with polite pauses, a throwaway profile, closed on exit. Stops at the first sign of a captcha/block.
//
//   node scripts/live-spotify-open.mjs --chrome <chrome.exe> --ids id1,id2,... [--out <file.json>] [--delay 5000]
//
// Each page load runs a list of attempts on the same page, resetting between them (Escape, then a check that menu and
// dialog are closed; a dirty page is reloaded and counts as a load). The plan is fixed so the volume stays near 12 loads:
//   visible x2, background tab x2, minimised window x2, off-screen window x2, visible with network capture x1.
// "untrusted" attempts are what a content script can do (isTrusted=false). "cdp" attempts use real input and stand for
// what chrome.debugger could do; they are listed so the cost can be compared, not because a plain extension may send them.
// Known limit of the recorded runs: in a hidden page the Escape-based reset does not work, so only the first attempt
// (click() in the main world) ran there; later attempts were skipped as "page would not reset", and the "background-tab"
// environment did not actually end up hidden (visibilityState stayed "visible"). Minimised and off-screen windows were hidden.
// Network: only URL host+path of fetch/XHR requests and the response size are recorded, never headers or bodies.
import { writeFileSync } from "node:fs";
import { clearTimeout } from "node:timers";
import { connect, launchChromium, sleep } from "./lib/cdp.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const ids = option("--ids", "").split(",").filter(Boolean);
const outFile = option("--out", "");
const delay = Number(option("--delay", "5000"));
const port = 9353;
if (!chromePath || ids.length < 2) throw new Error("Pass --chrome and at least two --ids.");

// Page-side helpers, installed in whichever world is asked (main or the isolated one a content script lives in).
const PAGE = String.raw`(() => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const more = () => document.querySelector("main button[data-testid='more-button']");
  const item = () => [...document.querySelectorAll("[role='menuitem']")].find((e) => /credits/i.test(norm(e.textContent)) && norm(e.textContent).length < 30);
  const dialog = () => document.querySelector("dialog[aria-label][open]:has([role='group'])");
  const rows = () => dialog() ? dialog().querySelectorAll("[role='group'][aria-labelledby]").length : 0;
  const menuOpen = () => !!document.querySelector("[role='menu']");
  const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const seq = (el) => {
    const p = centre(el);
    const base = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y };
    el.dispatchEvent(new PointerEvent("pointerover", { ...base, pointerId: 1, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mouseover", base));
    for (const t of ["pointerdown", "mousedown"]) el.dispatchEvent(new (t.startsWith("p") ? PointerEvent : MouseEvent)(t, { ...base, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    el.focus();
    for (const t of ["pointerup", "mouseup", "click"]) el.dispatchEvent(new (t.startsWith("p") ? PointerEvent : MouseEvent)(t, { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  };
  const key = (el, k) => { el.focus(); for (const t of ["keydown", "keypress", "keyup"]) el.dispatchEvent(new KeyboardEvent(t, { key: k, code: k === " " ? "Space" : k, keyCode: k === " " ? 32 : 13, which: k === " " ? 32 : 13, bubbles: true, cancelable: true, composed: true })); };
  window.__op = { norm, more, item, dialog, rows, menuOpen, centre, act: (kind, which) => { const el = which === "more" ? more() : item(); if (!el) return false; if (kind === "click") el.click(); else if (kind === "seq") seq(el); else if (kind === "enter") key(el, "Enter"); else if (kind === "space") key(el, " "); else if (kind === "focus") { el.scrollIntoView({ block: "center" }); el.focus(); } return true; } };
  return true;
})()`;

const ATTEMPTS = [
  { name: "click()", world: "main", kind: "click" },
  { name: "click()", world: "isolated", kind: "click" },
  { name: "pointer+mouse+click sequence", world: "main", kind: "seq" },
  { name: "pointer+mouse+click sequence", world: "isolated", kind: "seq" },
  { name: "keyboard Enter events (untrusted)", world: "main", kind: "enter" },
  { name: "keyboard Enter events (untrusted)", world: "isolated", kind: "enter" },
  { name: "keyboard Space events (untrusted)", world: "isolated", kind: "space" },
  { name: "cdp mouse (stands for chrome.debugger)", world: "main", kind: "cdp-mouse", trusted: true },
  { name: "cdp keyboard Enter (stands for chrome.debugger)", world: "main", kind: "cdp-key", trusted: true },
];

const ENVS = [
  { env: "visible", loads: 2 },
  { env: "background-tab", loads: 2 },
  { env: "minimised-window", loads: 2 },
  { env: "offscreen-window", loads: 2 },
  { env: "visible-network", loads: 1 },
];

const browser = launchChromium({ chromePath, dist: "", port, loadVia: "protocol" });
const hardStop = setTimeout(async () => {
  console.log("TIMEOUT");
  await browser.stop();
  process.exit(2);
}, 1_200_000);
let loads = 0;
const records = [];
let blocker = null;
const post = (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init).catch(() => undefined);
const closeTarget = (id) => post(`/json/close/${id}`);

async function browserSession() {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  return connect(v.webSocketDebuggerUrl);
}

/** Open a page in the environment under test; returns the CDP session, target and what was observed. */
async function openPage(env, url) {
  loads++;
  const info = { env };
  let target;
  let blank;
  const bs = await browserSession();
  if (env === "background-tab") {
    // The tab to leave in front, then the page under test, then bring the first back: the page ends up hidden.
    blank = await browser.openTab("about:blank");
    await sleep(500);
    target = await browser.openTab("about:blank");
  } else if (env === "minimised-window" || env === "offscreen-window") {
    const geometry =
      env === "offscreen-window" ? { left: -4000, top: -4000, width: 1100, height: 800 } : { width: 1100, height: 800 };
    const { targetId } = await bs.send("Target.createTarget", {
      url: "about:blank",
      newWindow: true,
      ...geometry,
      ...(env === "minimised-window" ? { windowState: "minimized" } : {}),
    });
    target = (await browser.targets()).find((t) => t.id === targetId);
    const { windowId } = await bs.send("Browser.getWindowForTarget", { targetId });
    info.windowId = windowId;
    if (env === "minimised-window")
      await bs.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
  } else {
    target = await browser.openTab("about:blank");
    await post(`/json/activate/${target.id}`);
  }
  const s = await connect(target.webSocketDebuggerUrl);
  await s.send("Network.enable");
  await s.send("Page.enable");
  await s.send("Network.setExtraHTTPHeaders", { headers: { "Accept-Language": "en-US,en;q=0.9" } });
  await s.send("Emulation.setLocaleOverride", { locale: "en-US" }).catch(() => undefined);
  await s.send("Page.navigate", { url });
  if (env === "background-tab") {
    await post(`/json/activate/${blank.id}`);
    await sleep(800);
  }
  if (env === "offscreen-window" || env === "minimised-window") {
    const b = await bs.send("Browser.getWindowBounds", { windowId: info.windowId });
    info.bounds = b.bounds;
  }
  return { s, bs, target, blank, info };
}

async function waitFor(s, expr, ms = 15000, ctx) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evalIn(s, expr, ctx).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

const evalIn = async (s, expression, contextId) => {
  const { result, exceptionDetails } = await s.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    ...(contextId ? { contextId } : {}),
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

const cdpMouse = async (s, p) => {
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
};
const cdpKey = async (s, key, code, vk) => {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await s.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base, ...(key === "Enter" ? { text: "\r" } : {}) });
  await s.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
};

/** Put the page back to "no menu, no dialog" with real Escape presses; returns false if it will not clean up. */
async function reset(s) {
  for (let i = 0; i < 3; i++) {
    if (await evalIn(s, "!window.__op.menuOpen() && !window.__op.dialog()")) return true;
    await cdpKey(s, "Escape", "Escape", 27);
    await sleep(400);
  }
  return await evalIn(s, "!window.__op.menuOpen() && !window.__op.dialog()");
}

async function runAttempt(s, mainCtx, isoCtx, a) {
  const ctx = a.world === "isolated" ? isoCtx : mainCtx;
  const rec = { method: a.name, world: a.world, trusted: !!a.trusted, menu: false, dialog: false };
  const act = async (which) => {
    if (a.kind === "cdp-mouse") {
      const p = await evalIn(
        s,
        `(() => { const e = window.__op.${which === "more" ? "more" : "item"}(); if (!e) return null; e.scrollIntoView({block:'center'}); return window.__op.centre(e); })()`,
      );
      if (!p) return;
      await cdpMouse(s, p);
    } else if (a.kind === "cdp-key") {
      await evalIn(s, `window.__op.act('focus', '${which}')`);
      await cdpKey(s, "Enter", "Enter", 13);
    } else {
      await evalIn(s, `window.__op.act('${a.kind}', '${which}')`, ctx);
      // Enter on a button that the page left unactivated: a real page may also want Space, tried inside the Space attempt.
    }
  };
  await act("more");
  rec.menu = await waitFor(s, "!!window.__op.item()", 3000);
  if (rec.menu) {
    await act("item");
    rec.dialog = await waitFor(s, "window.__op.rows() > 0", 4000);
  }
  rec.rows = await evalIn(s, "window.__op.rows()");
  return rec;
}

/**
 * Is the credit data present without clicking? Opens the dialog with real input only to learn the names, then looks for
 * them in the page's own server markup (a plain fetch of the same URL without cookies), in the hydrated script tags and
 * on window globals, and lists the page's own fetch/XHR resource URLs (host and path only, from the Performance API).
 */
async function inspectWithoutClick(s) {
  await reset(s);
  const p = await evalIn(s, "window.__op.centre(window.__op.more())");
  await cdpMouse(s, p);
  await waitFor(s, "!!window.__op.item()", 3000);
  await cdpMouse(s, await evalIn(s, "window.__op.centre(window.__op.item())"));
  await waitFor(s, "window.__op.rows() > 0", 4000);
  return await evalIn(
    s,
    `(async () => {
      const names = [...document.querySelector("dialog[open]").querySelectorAll("span[dir='auto']")].map((e) => e.textContent.trim()).filter(Boolean);
      const server = await (await fetch(location.href, { credentials: "omit" })).text();
      const scripts = [...document.scripts].map((x) => ({ id: x.id, type: x.type, src: x.src ? new URL(x.src).host : "", len: x.textContent.length, names: names.filter((n) => x.textContent.includes(n)).length }));
      const globals = Object.keys(window).filter((k) => /state|data|store|spotify|__/i.test(k)).slice(0, 30);
      const res = performance.getEntriesByType("resource").filter((r) => ["fetch", "xmlhttprequest"].includes(r.initiatorType)).map((r) => { const u = new URL(r.name); return u.host + u.pathname.replace(/[0-9a-zA-Z]{22}/g, ":id").slice(0, 90); });
      return { nameCount: names.length, namesInServerHtml: names.filter((n) => server.includes(n)).length, serverLen: server.length, serverScripts: (server.match(/<script/g) || []).length, scripts: scripts.filter((x) => x.len > 0 || x.src).slice(0, 25), globals, fetchUrls: [...new Set(res)].slice(0, 40), creditsLikeUrls: [...new Set(res)].filter((u) => /credit/i.test(u)) };
    })()`,
  );
}

async function runLoad(env, id, withNetwork) {
  const t0 = Date.now();
  const { s, bs, target, blank, info } = await openPage(env, `https://open.spotify.com/track/${id}`);
  const rec = { id, ...info, attempts: [] };
  try {
    rec.visibility = await evalIn(s, "document.visibilityState");
    await waitFor(s, "document.readyState === 'complete'", 25000);
    rec.visibility = await evalIn(s, "document.visibilityState");
    if (
      await evalIn(
        s,
        "/captcha|unusual traffic|access denied|too many requests/i.test(document.body?.innerText.slice(0, 2000) || '')",
      )
    ) {
      blocker = `block or captcha text on ${id} (${env})`;
      return rec;
    }
    await evalIn(s, PAGE);
    const { frameTree } = await s.send("Page.getFrameTree");
    const world = await s.send("Page.createIsolatedWorld", {
      frameId: frameTree.frame.id,
      worldName: "geniescraper-spike",
    });
    const isoCtx = world.executionContextId;
    await evalIn(s, PAGE, isoCtx);
    if (!(await waitFor(s, "!!window.__op.more()", 20000))) {
      rec.error = "no more-button";
      return rec;
    }
    for (const a of ATTEMPTS) {
      if (a.trusted && env === "visible-network") continue;
      if (a.trusted && env === "visible" && a.kind === "cdp-mouse" && rec.attempts.some((x) => x.trusted && x.dialog))
        continue;
      if (!(await reset(s))) {
        rec.attempts.push({ method: a.name, world: a.world, skipped: "page would not reset" });
        continue;
      }
      try {
        rec.attempts.push(await runAttempt(s, null, isoCtx, a));
      } catch (e) {
        rec.attempts.push({ method: a.name, world: a.world, error: String(e.message ?? e).slice(0, 160) });
      }
      await sleep(600);
    }
    // Hidden environments: trusted input again with focus emulation on, which makes the page believe it has focus.
    if (env !== "visible" && env !== "visible-network") {
      await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);
      rec.focusEmulation = true;
      for (const a of ATTEMPTS.filter((x) => x.trusted)) {
        if (!(await reset(s))) continue;
        const r = await runAttempt(s, null, isoCtx, a);
        r.method += " + focus emulation";
        rec.attempts.push(r);
        await sleep(600);
      }
    }
    rec.visibilityAfter = await evalIn(s, "document.visibilityState");
    if (withNetwork) rec.noClick = await inspectWithoutClick(s);
  } catch (e) {
    rec.error = String(e.message ?? e).slice(0, 200);
  }
  rec.ms = Date.now() - t0;
  s.close();
  bs.close();
  await closeTarget(target.id);
  if (blank) await closeTarget(blank.id);
  return rec;
}

try {
  await sleep(1500);
  const plan = [];
  let n = 0;
  for (const { env, loads: count } of ENVS)
    for (let i = 0; i < count; i++) plan.push({ env, id: ids[n++ % ids.length] });
  for (const { env, id } of plan) {
    if (loads >= 15) break;
    const rec = await runLoad(env, id, env === "visible-network");
    records.push(rec);
    console.log(
      `${env} ${id} vis=${rec.visibility} ${rec.error ?? ""}`,
      rec.attempts.map((a) => `${a.method}/${a.world}: menu=${a.menu} dialog=${a.dialog}`).join(" | "),
    );
    if (blocker) {
      console.log("STOPPED:", blocker);
      break;
    }
    await sleep(delay);
  }
  const out = { loads, blocker, records };
  if (outFile) writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ loads, blocker }));
} finally {
  clearTimeout(hardStop);
  await browser.stop();
}
