// Renders the Chrome Web Store images from the real side panel with sample data: 1280x800 screenshots and the
// 440x280 promotional tile. Nothing here uses real songs, accounts, or Apple or Genius logos.
//
//   node scripts/store-assets.mjs --chrome <chrome.exe> [--out store/assets]
//
// It uses the browser's own headless screenshot, so it needs no extra package. Check every image by eye before
// uploading: the sample data is the tests' "Demo Artist / Demo Album".
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const chromePath = option("--chrome", process.env["CHROME_PATH"]);
if (!chromePath) throw new Error("Pass --chrome <path to a Chromium or Chrome executable> (or set CHROME_PATH).");
const out = resolve(root, option("--out", "store/assets"));
mkdirSync(out, { recursive: true });

const work = mkdtempSync(join(tmpdir(), "geniescraper-store-"));
await build({
  absWorkingDir: root,
  entryPoints: [join(root, "test/preview/store-preview.ts")],
  bundle: true,
  format: "iife",
  outfile: join(work, "preview.js"),
  logLevel: "error",
});
copyFileSync(join(root, "src/ui/panel.css"), join(work, "panel.css"));
copyFileSync(join(root, "icons/icon-128.png"), join(work, "icon-128.png"));

const SHOTS = [
  [
    "1-credits-list",
    "credits",
    "Read a whole album's credits at once",
    "Each track says if everything was found, or what needs a look.",
  ],
  [
    "2-track-credits",
    "track",
    "See exactly what will be pasted",
    "Songwriters, producers, copyright lines, cover art and a YouTube link, before anything is typed.",
  ],
  [
    "3-paste",
    "paste",
    "Fill the Genius form one key press at a time",
    "Press your key for each step. Nothing is saved for you: you check the form and save it.",
  ],
  [
    "4-settings",
    "settings",
    "Choose what to include",
    "Pick the credits, the keys and the pace. Optional lookups stay off until you turn them on.",
  ],
];

const style = `
  html, body { margin: 0; }
  body { background: #0d0d0c; color: #f4f3ee; font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
`;

function screenshotPage(name, size, body, extraHead = "") {
  const file = join(work, `${name}.html`);
  writeFileSync(
    file,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="panel.css"><style>${style}</style>${extraHead}</head><body>${body}</body></html>`,
  );
  return file;
}

function shoot(file, query, size, target) {
  execFileSync(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--window-size=${size[0]},${size[1]}`,
      "--virtual-time-budget=4000",
      `--screenshot=${target}`,
      `${pathToFileURL(file).href}${query}`,
    ],
    { stdio: "ignore" },
  );
  console.log(`wrote ${target}`);
}

for (const [name, screen, headline, line] of SHOTS) {
  const file = screenshotPage(
    name,
    [1280, 800],
    `<div style="display:flex;align-items:center;justify-content:center;gap:80px;height:100vh;padding:0 64px;box-sizing:border-box">
       <div style="max-width:420px"><h1 style="font-size:2.25rem;line-height:1.15;margin:0 0 16px">${headline}</h1>
         <p style="font-size:1.125rem;color:#a9a69b;margin:0">${line}</p></div>
       <div style="width:400px;max-height:720px;overflow:hidden;border:1px solid #3a3a36;border-radius:12px;background:#0d0d0c">
         <div id="app"></div></div>
     </div><script src="preview.js"></script>`,
  );
  shoot(file, `?screen=${screen}`, [1280, 800], join(out, `${name}.png`));
}

const tile = screenshotPage(
  "promo-tile",
  [440, 280],
  `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;height:100vh;text-align:center">
     <img src="icon-128.png" width="96" height="96" alt="" style="border-radius:22px">
     <div style="font-size:1.75rem;font-weight:600">Géniescraper</div>
     <div style="color:#a9a69b;padding:0 24px">Apple Music credits, into the Genius form</div>
   </div>`,
);
shoot(tile, "", [440, 280], join(out, "promo-tile-440x280.png"));
