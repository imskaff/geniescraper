// Builds the extension, checks the result, and writes the zip to upload to the Chrome Web Store.
//
//   npm run package
//
// Output: release/geniescraper-extension-<version>.zip (the same bytes every time for the same sources).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./lib/zip.mjs";
import { listFiles, validateDist } from "./lib/validate-dist.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

execFileSync(process.execPath, [join(root, "scripts", "build.mjs")], { cwd: root, stdio: "inherit" });

const problems = validateDist(dist, pkg.version);
if (problems.length > 0) {
  console.error("\nThe package is not ready:");
  for (const text of problems) console.error(`  - ${text}`);
  process.exit(1);
}

const entries = listFiles(dist).map((name) => ({ name, data: readFileSync(join(dist, name)) }));
const out = join(root, "release", `geniescraper-extension-${pkg.version}.zip`);
mkdirSync(dirname(out), { recursive: true });
const zip = createZip(entries);
writeFileSync(out, zip);
console.log(`\nWrote ${out}: ${entries.length} files, ${zip.length} bytes. Checks passed.`);
