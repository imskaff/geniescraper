// Opt-in check of the YouTube Data API lookup against the golden songs, with your own key.
// It runs the same code the extension runs on the API path (one search per phase, a retry only when a phase finds
// nothing) and reports, per song, the link found, whether it is accepted, and the quota units it spent.
// The key is read from the environment and sent only in a request header; it is never printed.
//
//   set YOUTUBE_API_KEY=<your key>          (PowerShell: $env:YOUTUBE_API_KEY = "<your key>")
//   node scripts/live-youtube-api.mjs [--limit 5]
//
// A full run of all golden songs costs roughly 100 units per search, so about 3,000 of the 10,000 free daily units.
import { build } from "esbuild";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const key = process.env["YOUTUBE_API_KEY"];
if (!key) throw new Error("Set YOUTUBE_API_KEY to your YouTube Data API key first (see docs/extension-plan.md).");

const out = join(mkdtempSync(join(tmpdir(), "geniescraper-yt-api-")), "lookup.mjs");
await build({
  absWorkingDir: root,
  stdin: {
    contents: `export { findYoutube } from "./src/lookups/youtube.ts";
export { apiPages } from "./src/lookups/youtubeApi.ts";
export { API_QUERIES_PER_PHASE } from "./src/background/youtube.ts";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
});
const { findYoutube, apiPages, API_QUERIES_PER_PHASE } = await import(pathToFileURL(out).href);

const golden = JSON.parse(readFileSync(join(root, "..", "tests", "golden", "youtube.json"), "utf-8")).slice(0, limit);

let units = 0;
const problems = new Set();
const getResult = async (url, headers) => {
  const kind = new URL(url).pathname.endsWith("/search") ? 100 : 1;
  try {
    const response = await fetch(url, { headers });
    if (response.ok) units += kind;
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return null;
  }
};

let accepted = 0;
let totalUnits = 0;
for (const g of golden) {
  const before = units;
  const pages = apiPages(getResult, key);
  const link = await findYoutube(pages, g.title, g.artist, { queriesPerPhase: API_QUERIES_PER_PHASE });
  if (pages.problem()) problems.add(pages.problem());
  const id = link.url.split("=").pop() ?? "";
  const ok = g.accept.includes(id) && link.isMusicVideo === g.is_music_video;
  if (ok) accepted++;
  totalUnits += units - before;
  console.log(
    `${ok ? "ok  " : "MISS"} ${g.id.padEnd(34)} ${(units - before).toString().padStart(4)} units  ${link.url || "(nothing)"}`,
  );
}
console.log(
  `\n${accepted}/${golden.length} accepted, ${totalUnits} units spent (${Math.round(totalUnits / golden.length)} per song).`,
);
if (problems.size) console.log(`The API reported: ${[...problems].join(", ")}`);
process.exitCode = accepted === golden.length ? 0 : 1;
