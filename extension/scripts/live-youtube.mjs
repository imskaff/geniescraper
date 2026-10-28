// Opt-in live check of the one-track YouTube look-up inside the real extension worker, with the optional YouTube
// permission pre-granted in a throwaway copy of the build (a script cannot click Chrome's permission prompt).
// It asks for the first tracks of an album one after another, a few seconds apart, as a user pasting would.
//
//   npm run build
//   node scripts/live-youtube.mjs --chrome <chrome.exe> [--tracks 8] [--gap 4]
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findServiceWorker, launchChromium, sleep, waitUntilReady } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
if (!chromePath) throw new Error("Pass --chrome <path to a Chromium or Chrome executable> (or set CHROME_PATH).");
const count = Number(option("--tracks", "8"));
const gapSeconds = Number(option("--gap", "4"));

const TRACKS = [
  "CHIHIRO",
  "BIRDS OF A FEATHER",
  "WILDFLOWER",
  "THE GREATEST",
  "L'AMOUR DE MA VIE",
  "THE DINER",
  "BITTERSUITE",
  "BLUE",
  "LUNCH",
  "SKINNY",
];
const golden = JSON.parse(readFileSync(join(root, "..", "tests", "golden", "youtube.json"), "utf-8"));
const chihiro = golden.find((g) => g.id === "eilish-hmhas-t3");

const dist = join(mkdtempSync(join(tmpdir(), "geniescraper-granted-")), "dist");
cpSync(join(root, "dist"), dist, { recursive: true });
const manifestPath = join(dist, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
manifest.host_permissions = [...manifest.host_permissions, ...manifest.optional_host_permissions];
delete manifest.optional_host_permissions;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const browser = launchChromium({ chromePath, dist, port: 9339 });
try {
  const workerTarget = await findServiceWorker(browser);
  const worker = await connect(workerTarget.webSocketDebuggerUrl);
  await waitUntilReady(worker);
  const extensionId = new URL(workerTarget.url).host;
  const tab = await browser.openTab(`chrome-extension://${extensionId}/ui/panel.html`);
  const panel = await connect(tab.webSocketDebuggerUrl);
  await sleep(800);
  let found = 0;
  for (const title of TRACKS.slice(0, count)) {
    const started = Date.now();
    const answer = await panel.evaluate(
      `chrome.runtime.sendMessage({ type: "youtube-lookup", title: ${JSON.stringify(title)}, artist: "Billie Eilish" })`,
    );
    const data = answer?.data ?? {};
    if (data.url) found++;
    const accepted =
      title === "CHIHIRO" ? ` accepted: ${chihiro.accept.includes(data.url?.split("=").pop() ?? "")}` : "";
    console.log(
      `${title}: ${data.url || "(none)"} mv=${String(data.isMusicVideo)} throttled=${String(data.throttled)} ${((Date.now() - started) / 1000).toFixed(1)}s${accepted}`,
    );
    await sleep(gapSeconds * 1000);
  }
  console.log(`${found}/${Math.min(count, TRACKS.length)} tracks got a link`);
} finally {
  await browser.stop();
}
