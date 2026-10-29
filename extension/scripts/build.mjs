// Bundles the extension into dist/, which is what gets loaded unpacked or zipped for the store.
// Output stays unminified and the CSP stays at the MV3 default: reviewers must be able to read what ships.
import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toSafariManifest } from "./lib/safari-manifest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// `--safari` builds the Safari variant (popup instead of side panel) into dist-safari/, for the Mac converter step.
const safari = process.argv.includes("--safari");
const outDir = safari ? "dist-safari" : "dist";
const dist = join(root, outDir);

const ENTRY_POINTS = {
  "background/worker": "src/background/worker.ts",
  "apple/content": "src/apple/content.ts",
  "ui/panel": "src/ui/panel.ts",
  "genius/content": "src/genius/content.ts",
};
const STATIC_PATHS = ["manifest.json", "_locales", "icons"];
// Files copied as they are, from source path to path inside dist/.
const STATIC_FILES = {
  "src/ui/panel.html": "ui/panel.html",
  "src/ui/panel.css": "ui/panel.css",
};

// Empty the folder instead of removing it: on Windows a browser that has the unpacked extension loaded holds the
// folder itself open, so removing it fails with EBUSY while its contents can still be replaced.
await mkdir(dist, { recursive: true });
for (const name of await readdir(dist)) await rm(join(dist, name), { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: ENTRY_POINTS,
  outdir: outDir,
  bundle: true,
  format: "iife",
  target: "chrome120",
  platform: "browser",
  legalComments: "none",
  logLevel: "info",
});

for (const path of STATIC_PATHS) {
  await cp(join(root, path), join(dist, path), { recursive: true });
}

for (const [from, to] of Object.entries(STATIC_FILES)) {
  await mkdir(dirname(join(dist, to)), { recursive: true });
  await cp(join(root, from), join(dist, to));
}

if (safari) {
  const chromeManifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf-8"));
  await writeFile(join(dist, "manifest.json"), JSON.stringify(toSafariManifest(chromeManifest), null, 2) + "\n");
}
