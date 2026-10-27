import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Credit } from "../../src/core/models";
import { mergedCredits } from "../../src/core/models";

// The Python project owns the saved Apple Music pages and the hand-reviewed golden files.
// They are read here, never written: refreshing them is bench.capture's job.
const REPO = join(import.meta.dirname, "..", "..", "..");

export interface Case {
  id: string;
  url: string;
  track_index: number;
}

export interface Golden {
  title: string;
  artist: string;
  credits: Credit[];
  phonographic_copyright: string;
  copyright_notice: string;
  cover_art_url: string;
}

export const CASES = JSON.parse(readFileSync(join(REPO, "bench", "cases.json"), "utf-8")) as Case[];

export function loadGolden(id: string): Golden {
  return JSON.parse(readFileSync(join(REPO, "tests", "golden", `${id}.json`), "utf-8")) as Golden;
}

/** A saved page as a Document; `kind` is "page" (album or song) or "credits" (after View Credits). */
export function loadFixture(id: string, kind: "page" | "credits"): Document {
  const html = readFileSync(join(REPO, "tests", "fixtures", `${id}.${kind}.html`), "utf-8");
  // happy-dom mis-parses a <style> inside an <svg> and drops the rest of the page, and it tries to load
  // iframes; browsers do neither. Neither styles nor frames affect what the parsers read, so both go.
  const stripped = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  return new DOMParser().parseFromString(stripped, "text/html");
}

/** Role to sorted artists after merging duplicate roles, so ordering differences do not matter. */
export function creditMap(credits: readonly Credit[]): Record<string, string[]> {
  return Object.fromEntries(
    mergedCredits(credits)
      .map((credit): [string, string[]] => [credit.role, [...credit.artists].sort()])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Host- and size-independent identity of an mzstatic artwork URL ("" if not one). */
export function artworkKey(url: string): string {
  return /\/image\/thumb\/(.+)\/[^/]+$/.exec(url)?.[1] ?? "";
}
