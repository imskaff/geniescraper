// Opt-in smoke check of the whole extension on the machine and browser it runs on, built for CI on Windows, macOS and
// Linux runners but just as good by hand. It loads the built extension into an installed Chrome or Edge, reads one
// real album track from live Apple Music through the real panel, and checks what the user would see against the
// hand-reviewed golden file: the track, its credits, the ℗ line and the release date. It then opens the paste screen
// (no Genius needed). It prints the operating system and browser it really ran on, and exits with a failure code
// unless every check passed.
//
//   npm run build
//   node scripts/live-smoke.mjs --chrome <chrome or msedge executable> [--expect-os mac|win|linux]
import { readFileSync } from "node:fs";
import { clearTimeout } from "node:timers";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findServiceWorker, launchChromium, sleep, waitUntilReady } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
const expectOs = option("--expect-os", "");
if (!chromePath) throw new Error("Pass --chrome <path to Chrome or Edge> (or set CHROME_PATH).");

const golden = JSON.parse(readFileSync(join(root, "..", "tests", "golden", "eilish-hmhas-t3.json"), "utf-8"));
const ALBUM_URL = golden.apple_music_url;
const TRACK_INDEX = 2; // zero-based: CHIHIRO, the golden track
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const [year, month, day] = golden.release_date.split("-").map(Number);
const RELEASED = `${MONTHS[month - 1]} ${String(day)}, ${String(year)}`;

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

const port = 9342;
const browser = launchChromium({ chromePath, dist: join(root, "dist"), port });
const hardStop = setTimeout(async () => {
  console.log("FAIL  timed out after 3 minutes");
  await browser.stop();
  process.exit(1);
}, 180_000);

try {
  const version = await (await fetch(`http://127.0.0.1:${String(port)}/json/version`).catch(() => null))?.json?.();
  const workerTarget = await findServiceWorker(browser);
  const worker = await connect(workerTarget.webSocketDebuggerUrl);
  await waitUntilReady(worker);

  const platform = await worker.evaluate("chrome.runtime.getPlatformInfo()");
  const info = version ?? (await (await fetch(`http://127.0.0.1:${String(port)}/json/version`)).json());
  console.log(`      browser: ${String(info.Browser)} on ${String(platform.os)} (${String(platform.arch)})`);
  check("the extension's service worker started", true, workerTarget.url);
  if (expectOs) check(`it runs on ${expectOs}`, platform.os === expectOs, platform.os);

  // The first-time set-up is not what this check is about.
  await worker.evaluate("chrome.storage.sync.set({ settings: { onboarded: true } })");
  const extensionId = new URL(workerTarget.url).host;
  const tabInfo = await (
    await fetch(`http://127.0.0.1:${String(port)}/json/new?chrome-extension://${extensionId}/ui/panel.html`, {
      method: "PUT",
    })
  ).json();
  const panel = await connect(tabInfo.webSocketDebuggerUrl);
  await panel.send("Emulation.setDeviceMetricsOverride", {
    width: 400,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const until = async (expression, what, ms = 40000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await panel.evaluate(expression).catch(() => false)) return true;
      await sleep(250);
    }
    check(`waited for ${what}`, false, "timed out");
    return false;
  };

  await until("!!document.querySelector('#link')", "the link screen");
  await panel.evaluate(`(() => {
    const input = document.querySelector('#link');
    input.value = ${JSON.stringify(ALBUM_URL)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`);
  const gotTracks = await until("!!document.querySelector('[data-key=\"track-0\"]')", "the track list");
  check("the album's tracks are listed", gotTracks);
  if (!gotTracks) throw new Error("no track list");

  await panel.evaluate(`document.querySelector('[data-key="track-${String(TRACK_INDEX)}"]').click()`);
  await sleep(200);
  await panel.evaluate("document.querySelector('[data-key=go]').click()");
  const read = await until(
    "/^Got credits for 1 track/.test(document.querySelector('#status')?.textContent ?? '')",
    "the credits of the track",
    90000,
  );
  check("the track's credits were read from live Apple Music", read);
  if (!read) throw new Error("no credits");
  await panel.evaluate(`document.querySelector('[data-key="show-${String(TRACK_INDEX)}"]')?.click()`);
  await sleep(500);

  const page = JSON.parse(
    await panel.evaluate(`(() => {
      const dts = [...document.querySelectorAll('dl.credits dt')];
      const row = (label) => dts.find((d) => d.textContent === label)?.nextElementSibling?.textContent ?? null;
      return JSON.stringify({
        title: document.querySelector('#track-heading')?.textContent ?? '',
        released: row('Released'),
        labels: dts.map((d) => d.textContent),
        text: document.querySelector('dl.credits')?.textContent ?? '',
      });
    })()`),
  );
  check("the track is the golden one", page.title.includes(golden.title), page.title);
  for (const credit of golden.credits.slice(0, 3)) {
    check(
      `the credit ${credit.role} lists ${credit.artists.join(", ")}`,
      page.labels.includes(credit.role) && credit.artists.every((name) => page.text.includes(name)),
    );
  }
  check("the ℗ line is shown", page.text.includes(golden.phonographic_copyright.replace(/^℗\s*/, "")));
  check(`the release date is ${RELEASED}`, page.released === RELEASED, String(page.released));

  // The paste screen opens (Genius is not needed to see it).
  const started = await panel.evaluate(
    "(() => { const b = document.querySelector('[data-key=start]'); b?.click(); return !!b; })()",
  );
  check("Start pasting is offered", started);
  const pasteScreen = await until(
    "document.querySelector('h2')?.textContent === 'Paste into Genius'",
    "the paste screen",
  );
  check("the paste screen opens", pasteScreen);
  const total = Number(
    ((await panel.evaluate("document.querySelector('.progress')?.textContent ?? ''")) ?? "").match(/of (\d+)/)?.[1] ??
      0,
  );
  check("the paste queue has steps", total > 10, String(total));

  const appleTabs = (await browser.targets()).filter(
    (t) => t.type === "page" && t.url.startsWith("https://music.apple.com"),
  );
  check("no Apple Music tab is left open", appleTabs.length === 0, String(appleTabs.length));
} catch (error) {
  check("the run finished without an error", false, error instanceof Error ? error.message : String(error));
} finally {
  clearTimeout(hardStop);
  await browser.stop();
}
console.log(failures.length === 0 ? "\nAll checks passed." : `\n${String(failures.length)} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
