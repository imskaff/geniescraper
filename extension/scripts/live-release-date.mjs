// Opt-in live check of the release date: the real panel against live Apple Music, reading one track and
// printing what the credits screen shows as "Released". Branded Chrome ignores --load-extension, so the extension
// is loaded over the DevTools protocol (Extensions.loadUnpacked) into a throwaway profile.
//
//   npm run build
//   node scripts/live-release-date.mjs --chrome <chrome.exe> --url <album or song link> [--track <1-based>]
import { spawn, spawnSync } from "node:child_process";
import { clearTimeout } from "node:timers";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findServiceWorker, sleep, waitUntilReady } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const url = option("--url", "");
const track = Number(option("--track", "1"));
const port = 9341;
if (!chromePath || !url) throw new Error("Pass --chrome <chrome.exe> and --url <Apple Music link>.");

const profile = mkdtempSync(join(tmpdir(), "geniescraper-release-"));
const chrome = spawn(
  chromePath,
  [
    `--remote-debugging-port=${String(port)}`,
    "--enable-unsafe-extension-debugging",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const stop = () => {
  spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // The profile is a throwaway; Windows may still hold a file for a moment.
  }
};
const hardStop = setTimeout(() => {
  console.log("TIMEOUT");
  stop();
  process.exit(2);
}, 100_000);

try {
  const get = async (path) => {
    for (let i = 0; i < 50; i++) {
      try {
        return await (await fetch(`http://127.0.0.1:${String(port)}${path}`)).json();
      } catch {
        await sleep(200);
      }
    }
    throw new Error("Chrome's debugging port never answered.");
  };
  const version = await get("/json/version");
  const browserSession = await connect(version.webSocketDebuggerUrl);
  const loaded = await browserSession.send("Extensions.loadUnpacked", { path: join(root, "dist") });
  console.log("loaded extension", loaded.id);

  const browser = { targets: () => get("/json") };
  const workerTarget = await findServiceWorker(browser);
  const worker = await connect(workerTarget.webSocketDebuggerUrl);
  await waitUntilReady(worker);
  const extensionId = new URL(workerTarget.url).host;

  const tabInfo = await (
    await fetch(`http://127.0.0.1:${String(port)}/json/new?chrome-extension://${extensionId}/ui/panel.html`, {
      method: "PUT",
    })
  ).json();
  const panel = await connect(tabInfo.webSocketDebuggerUrl);
  await panel.send("Emulation.setDeviceMetricsOverride", {
    width: 400,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const until = async (expression, what, ms = 30000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await panel.evaluate(expression)) return;
      await sleep(200);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const clickButton = (label) =>
    panel.evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click()`,
    );

  // First-time set-up: click through it.
  await until("document.querySelector('h2')?.textContent === 'Welcome to Géniescraper'", "the set-up");
  await sleep(3500);
  await clickButton("Get started");
  for (let i = 0; i < 3; i++) {
    await sleep(300);
    await clickButton("Next");
  }
  await sleep(300);
  await clickButton("Start using");
  await until("!!document.querySelector('#link')", "the link screen");

  // The link box: type the link and press Enter.
  await panel.evaluate("document.querySelector('#link').focus()");
  await panel.send("Input.insertText", { text: url });
  await panel.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    text: "\r",
  });
  await panel.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  // An album lists its tracks to pick from; a single goes straight to its credits.
  await until(
    "!!document.querySelector('[data-key=\"track-0\"]') || document.querySelector('h2')?.textContent === 'Credits'",
    "the track list or the credits",
  );
  const heading = await panel.evaluate("document.querySelector('h2')?.textContent");
  if (await panel.evaluate("!!document.querySelector('[data-key=\"track-0\"]')")) {
    await panel.evaluate(`document.querySelector('[data-key="track-${String(track - 1)}"]').click()`);
    await sleep(200);
    await panel.evaluate("document.querySelector('[data-key=go]').click()");
  }
  await until(
    "/^Got credits for 1 track/.test(document.querySelector('#status')?.textContent ?? '')",
    "the read",
    60000,
  );
  await panel.evaluate(`document.querySelector('[data-key="show-${String(track - 1)}"]')?.click()`);
  await sleep(500);
  const result = await panel.evaluate(`(() => {
    const dts = [...document.querySelectorAll('dl.credits dt')];
    const released = dts.find((d) => d.textContent === 'Released');
    return JSON.stringify({
      page: ${JSON.stringify(heading)},
      track: document.querySelector('#track-heading')?.textContent,
      released: released ? released.nextElementSibling.textContent : null,
    });
  })()`);
  console.log("RESULT", result);
} catch (error) {
  console.log("ERROR", error instanceof Error ? error.message : String(error));
} finally {
  clearTimeout(hardStop);
  stop();
}
process.exit(0);
