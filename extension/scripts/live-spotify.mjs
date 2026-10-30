// Throwaway opt-in spike: can the signed-out Spotify web player's "Show credits" dialog be read reliably, in a
// visible and in a hidden background tab? No extension, no login, no credentials, one request at a time with
// polite delays. One browser window in a throwaway profile, closed on exit. Stops at the first sign of a captcha
// or block instead of working around it.
//
//   node scripts/live-spotify.mjs --chrome <chrome.exe> --ids id1,id2,... [--out <dir>] [--delay 4000]
//   node scripts/live-spotify.mjs --chrome <chrome.exe> --search "query one;query two"   (prints track ids only)
import { mkdirSync, writeFileSync } from "node:fs";
import { clearTimeout } from "node:timers";
import { join } from "node:path";
import { connect, launchChromium, sleep } from "./lib/cdp.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const ids = option("--ids", "").split(",").filter(Boolean);
const searches = option("--search", "").split(";").filter(Boolean);
const outDir = option("--out", "");
const delay = Number(option("--delay", "4000"));
const port = 9352;
if (!chromePath || (!ids.length && !searches.length)) throw new Error("Pass --chrome and --ids or --search.");

// Page-side helpers, injected as one string. Everything is found by role or aria-label, never by class name.
const PAGE = String.raw`(() => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const blocked = () => /captcha|unusual traffic|access denied|too many requests/i.test(document.body?.innerText.slice(0, 2000) || "");
  const moreButton = () =>
    document.querySelector("[data-testid='action-bar-row'] button[data-testid='more-button'], main button[data-testid='more-button']");
  const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const creditsItem = () => [...document.querySelectorAll("[role='menuitem'], [role='menu'] button, [role='menu'] li")].find((e) => /credits/i.test(norm(e.textContent)) && norm(e.textContent).length < 30);
  const dialog = () => document.querySelector("dialog[aria-label][open]:has([role='group'])");
  const syntheticClick = (el) => { for (const t of ["pointerdown","mousedown","pointerup","mouseup","click"]) el.dispatchEvent(new (t.startsWith("pointer") ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, composed: true, view: window, button: 0 })); };
  const readDialog = () => {
    const d = dialog();
    if (!d) return null;
    // The dialog is a native <dialog aria-label="Credits">. A section is a <span> heading followed by role=group rows;
    // a row is span[dir=auto] (name) plus p[id^=listrow-subtitle-] (role). "Sources" is a group of two plain spans.
    const rows = [];
    for (const g of d.querySelectorAll("[role='group'][aria-labelledby]")) {
      const first = g.parentElement?.firstElementChild;
      const section = first && first.tagName === "SPAN" ? norm(first.textContent) : "";
      const nameEl = g.querySelector("span[dir='auto']");
      if (nameEl) rows.push({ section, name: norm(nameEl.textContent), role: norm(g.querySelector("[id^='listrow-subtitle-']")?.textContent) });
      else {
        const spans = [...g.querySelectorAll("span")].map((x) => norm(x.textContent));
        rows.push({ section: spans[0] || "", name: spans.slice(1).join(", "), role: "" });
      }
    }
    return { text: norm(d.innerText), rows, html: d.outerHTML };
  };
  window.__sp = { blocked, moreButton, creditsItem, dialog, syntheticClick, readDialog, centre, norm };
  return true;
})()`;

const browser = launchChromium({ chromePath, dist: "", port, loadVia: "protocol" });
const hardStop = setTimeout(async () => {
  console.log("TIMEOUT");
  await browser.stop();
  process.exit(2);
}, 900_000);
let requests = 0;
const results = [];
const closeTarget = (id) => fetch(`http://127.0.0.1:${port}/json/close/${id}`).catch(() => undefined);

async function newPage(url) {
  requests++;
  // Open blank, ask for English (Accept-Language and locale), then navigate: the player localizes by language.
  const target = await browser.openTab("about:blank");
  const s = await connect(target.webSocketDebuggerUrl);
  await s.send("Network.enable");
  await s.send("Network.setExtraHTTPHeaders", { headers: { "Accept-Language": "en-US,en;q=0.9" } });
  await s.send("Emulation.setLocaleOverride", { locale: "en-US" }).catch(() => undefined);
  await s.send("Page.navigate", { url });
  return { target, s };
}

async function waitFor(s, expr, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await s.evaluate(expr).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

async function mouseClick(s, p) {
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
}

/** Open the dialog on a loaded track page. `how` is "cdp" (real input) or "synthetic" (what a content script can do). */
async function openCredits(s, how) {
  const info = { how, selectors: [] };
  await s.evaluate(PAGE);
  if (!(await waitFor(s, "!!window.__sp.moreButton()", 20000)))
    return { ...info, ok: false, why: "no more-button in the action bar" };
  info.selectors.push(
    "button[data-testid=more-button] in the track's action bar (aria-label 'More options for: <title>')",
  );
  const click = async (getter) => {
    if (how === "cdp") {
      const p = await s.evaluate(
        `(() => { const e = ${getter}; if (!e) return null; e.scrollIntoView({block:'center'}); return window.__sp.centre(e); })()`,
      );
      if (!p) return false;
      await mouseClick(s, p);
    } else {
      await s.evaluate(
        `(() => { const e = ${getter}; if (!e) return false; window.__sp.syntheticClick(e); return true; })()`,
      );
    }
    return true;
  };
  await click("window.__sp.moreButton()");
  if (!(await waitFor(s, "!!window.__sp.creditsItem()", 5000)))
    return { ...info, ok: false, why: "no credits menu item after opening the options menu" };
  info.selectors.push("[role=menuitem] whose text contains 'credits' (View credits)");
  await click("window.__sp.creditsItem()");
  if (!(await waitFor(s, "!!window.__sp.dialog() && window.__sp.readDialog().rows.length > 0", 8000)))
    return { ...info, ok: false, why: "dialog did not open or has no rows" };
  info.selectors.push("dialog[aria-label][open] with [role=group][aria-labelledby] rows and [id^=listrow-subtitle-]");
  return { ...info, ok: true };
}

try {
  await sleep(1500);
  if (searches.length) {
    for (const q of searches) {
      const { target, s } = await newPage(`https://open.spotify.com/search/${encodeURIComponent(q)}/tracks`);
      await waitFor(s, "document.querySelectorAll(\"a[href^='/track/']\").length > 0", 15000);
      const found = await s.evaluate(
        `[...document.querySelectorAll("a[href^='/track/']")].slice(0,8).map(a => a.getAttribute('href').slice(7) + ' | ' + a.textContent.trim().slice(0,40))`,
      );
      console.log(q, "=>", JSON.stringify(found));
      s.close();
      await closeTarget(target.id);
      await sleep(delay);
    }
  } else {
    // Real input on every id; a synthetic-event run and a background-tab run on the first few ids only (volume).
    const modes = [
      { name: "visible-cdp", how: "cdp", hidden: false },
      { name: "visible-synthetic", how: "synthetic", hidden: false },
      { name: "hidden-cdp", how: "cdp", hidden: true },
    ];
    const plan = [
      ...ids.map((id) => ({ id, mode: modes[0] })),
      ...ids.slice(0, 3).map((id) => ({ id, mode: modes[1] })),
      ...ids.slice(0, 3).map((id) => ({ id, mode: modes[2] })),
    ];
    let blocker = null;
    for (const { id, mode } of plan) {
      const t0 = Date.now();
      const rec = { id, mode: mode.name };
      let page;
      let front;
      try {
        if (mode.hidden) {
          front = await browser.openTab("about:blank");
          await sleep(500);
        }
        page = await newPage(`https://open.spotify.com/track/${id}`);
        if (mode.hidden) {
          await fetch(`http://127.0.0.1:${port}/json/activate/${front.id}`);
          await sleep(800);
        }
        const { s } = page;
        rec.visibility = await s.evaluate("document.visibilityState");
        await waitFor(s, "document.readyState === 'complete'", 20000);
        if (await s.evaluate(PAGE + " && window.__sp.blocked()")) {
          blocker = `block or captcha text on ${id}`;
          rec.ok = false;
          results.push(rec);
          break;
        }
        rec.title = await s.evaluate("document.title");
        Object.assign(rec, await openCredits(s, mode.how));
        if (rec.ok) {
          const d = await s.evaluate(
            "(() => { const r = window.__sp.readDialog(); return { text: r.text, rows: r.rows }; })()",
          );
          rec.text = d.text;
          rec.rows = d.rows;
          if (outDir && mode.name === "visible-cdp") {
            mkdirSync(outDir, { recursive: true });
            writeFileSync(join(outDir, `${id}.dialog.html`), await s.evaluate("window.__sp.readDialog().html"));
          }
        }
        rec.meta = await s.evaluate(
          `(() => { const m = (n) => document.querySelector('meta[name="' + n + '"], meta[property="' + n + '"]')?.content || ''; return { og: m('og:title'), desc: m('og:description'), date: m('music:release_date') }; })()`,
        );
        rec.copyright = await s.evaluate(
          `[...document.querySelectorAll('main *')].filter(e => e.children.length === 0 && /^[\\u00a9\\u2117]\\s/.test(e.textContent.trim())).map(e => e.textContent.trim()).slice(0,3)`,
        );
        s.close();
      } catch (e) {
        rec.ok = false;
        rec.why = String(e.message ?? e).slice(0, 200);
      }
      if (page) await closeTarget(page.target.id);
      if (front) await closeTarget(front.id);
      rec.ms = Date.now() - t0;
      results.push(rec);
      console.log(`${rec.mode} ${id} ok=${rec.ok} vis=${rec.visibility} ${rec.ms}ms ${rec.why ?? ""}`);
      await sleep(delay);
    }
    console.log(JSON.stringify({ requests, blocker, results }, null, 1));
    if (blocker) console.log("STOPPED:", blocker);
  }
} finally {
  clearTimeout(hardStop);
  await browser.stop();
}
