// Bundles the extension into dist/, which is what gets loaded unpacked or zipped for the store.
// Output stays unminified and the CSP stays at the MV3 default: reviewers must be able to read what ships.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const ENTRY_POINTS = {
  "background/worker": "src/background/worker.ts",
  "apple/content": "src/apple/content.ts",
};
const STATIC_PATHS = ["manifest.json", "_locales", "icons"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ENTRY_POINTS,
  outdir: "dist",
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
