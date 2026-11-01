// Records the release animation from the real side panel with sample data: no real songs, accounts, or logos.
//
//   node scripts/release-demo.mjs --chrome <chrome.exe> [--out ../img/extension-demo.gif]
//
// It opens one headless browser window (no extension, no network, no profile of yours), plays the story in
// test/preview/demo.ts scene by scene, saves screenshots and joins them into a GIF with ffmpeg, which must be on
// the PATH. Watch the result before attaching it to a release.
import { build } from "esbuild";
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connect, sleep } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
if (!chromePath) throw new Error("Pass --chrome <path to a Chromium or Chrome executable> (or set CHROME_PATH).");
const target = resolve(root, option("--out", "../img/extension-demo.gif"));
mkdirSync(dirname(target), { recursive: true });

const WIDTH = 960;
const HEIGHT = 540;
const GIF_FPS = 5;
/** Each scene and how long it stays, in milliseconds. */
const SCENES = [
  ["listening", 1800],
  ["found", 3200],
  ["reading", 1900],
  ["tracks", 2600],
  ["credits", 2200],
  ["detail", 3400],
  ["spotify", 4800],
  ["genius", 2400],
  ["paste", 4400],
  ["pause", 2800],
];

const work = mkdtempSync(join(tmpdir(), "geniescraper-demo-"));
await build({
  absWorkingDir: root,
  entryPoints: [join(root, "test/preview/demo.ts")],
  bundle: true,
  format: "iife",
  outfile: join(work, "demo.js"),
  logLevel: "error",
});
copyFileSync(join(root, "src/ui/panel.css"), join(work, "panel.css"));
writeFileSync(
  join(work, "demo.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="panel.css"><style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body { background: #0d0d0c; color: #f4f3ee; font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
  .stage { display: flex; align-items: center; justify-content: center; gap: 56px; height: 100vh; padding: 0 48px; box-sizing: border-box; }
  .copy { width: 380px; }
  #title { font-size: 2rem; line-height: 1.15; font-weight: 600; margin: 0 0 12px; }
  #line { font-size: 1.05rem; color: #a9a69b; margin: 0; }
  .frame { width: 400px; height: 500px; overflow: hidden; border: 1px solid #3a3a36; border-radius: 12px; background: #0d0d0c; display: flex; flex-direction: column; }
  /* The header is sticky inside this scrolling box: pulled up by the panel's padding so scrolled text never shows above it. */
  /* Still frames compress far better than the panel's looping glows, and the GIF stays small. */
  #app * { animation: none !important; transition: none !important; }
  #app .bar { top: calc(var(--space-4) * -1); }
  #app { flex: 1; min-height: 0; overflow-y: auto; }
  #form { margin-top: 24px; border: 1px solid #3a3a36; border-radius: 8px; padding: 10px 12px; font-size: 0.8rem; background: #151513; }
  #form h2 { margin: 0 0 6px; font-size: 0.75rem; font-weight: 600; color: #a9a69b; }
  #form .row { display: grid; grid-template-columns: 9.5rem 1fr; gap: 8px; min-height: 1.6em; padding: 2px 0; border-bottom: 1px solid #262623; color: #f4f3ee; }
  #form .row span:first-child { color: #a9a69b; }
  #form .row.now { background: #2a2718; }
  </style></head><body><div class="stage"><div class="copy"><h1 id="title"></h1><p id="line"></p>
  <div id="form" hidden><h2>Genius edit form (sample)</h2><div id="rows"></div></div></div>
  <div class="frame"><div id="app"></div></div></div><script src="demo.js"></script></body></html>`,
);

const port = 9331 + Math.floor(Math.random() * 500);
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${String(port)}`,
    `--user-data-dir=${join(work, "profile")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const frames = join(work, "frames");
mkdirSync(frames);
let count = 0;
let seconds;
try {
  let page;
  for (let attempt = 0; attempt < 50 && !page; attempt++) {
    page = await fetch(`http://127.0.0.1:${String(port)}/json`)
      .then((r) => r.json())
      .then((list) => list.find((t) => t.type === "page"))
      .catch(() => undefined);
    if (!page) await sleep(200);
  }
  if (!page) throw new Error("The browser did not start.");
  const session = await connect(page.webSocketDebuggerUrl);
  await session.send("Page.enable");
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await session.send("Page.navigate", { url: pathToFileURL(join(work, "demo.html")).href });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await session.evaluate("typeof window.scene === 'function'").catch(() => false)) break;
    await sleep(200);
  }

  // The panel is built asynchronously; filming starts once it is on screen, so no frame is empty.
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await session.evaluate("window.ready === true").catch(() => false)) break;
    await sleep(100);
  }

  const snap = async () => {
    const { data } = await session.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(frames, `${String(count++).padStart(5, "0")}.png`), Buffer.from(data, "base64"));
  };

  const started = Date.now();
  for (const [name, hold] of SCENES) {
    // The scene is started without waiting for it, so what it does (the dots while reading) is filmed as it happens.
    void session.evaluate(`window.scene(${JSON.stringify(name)})`);
    const until = Date.now() + hold;
    while (Date.now() < until) await snap();
  }
  seconds = (Date.now() - started) / 1000;
  session.close();
} finally {
  chrome.kill();
}

// The screenshots come as fast as the browser gives them, so they are read at the rate they were taken (real time)
// and thinned to the GIF's own rate.
const captured = count / seconds;
console.log(
  `${String(count)} frames in ${seconds.toFixed(1)} s (${captured.toFixed(1)} a second), written at ${String(GIF_FPS)}`,
);
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    captured.toFixed(3),
    "-i",
    join(frames, "%05d.png"),
    "-filter_complex",
    `fps=${String(GIF_FPS)},split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
    "-loop",
    "0",
    target,
  ],
  { stdio: "inherit" },
);
await sleep(300);
rmSync(work, { recursive: true, force: true });
console.log(`wrote ${target}`);
