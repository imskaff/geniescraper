import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../src/providers/registry";

const ROOT = join(import.meta.dirname, "..", "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf-8")) as {
  host_permissions?: string[];
};
const build = readFileSync(join(ROOT, "scripts", "build.mjs"), "utf-8");

describe("every shipped provider is declared where it says", () => {
  it.each(PROVIDERS.map((p) => [p.id, p] as const))("%s: origins are in the manifest list it names", (_id, p) => {
    for (const origin of p.origins) expect(manifest.host_permissions).toContain(origin);
  });

  it.each(PROVIDERS.map((p) => [p.id, p] as const))("%s: its content script is a build entry", (_id, p) => {
    expect(build).toContain(`"${p.contentScript.replace(/\.js$/, "")}":`);
  });
});
