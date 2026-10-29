import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript build helper, with no type declarations
import { toSafariManifest } from "../scripts/lib/safari-manifest.mjs";
import { isPopupSurface, reportsClosing } from "../src/ui/surface";

declare function toSafariManifest(manifest: unknown): Record<string, unknown> & {
  permissions: string[];
  action: { default_popup?: string; default_title?: string };
};

const chromeManifest: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "..", "manifest.json"), "utf-8"));

describe("popup surface", () => {
  it("is a popup exactly when the browser has no side panel API", () => {
    expect(isPopupSurface({})).toBe(true);
    expect(isPopupSurface({ sidePanel: { open: () => undefined } })).toBe(false);
  });

  it("only a side panel reports closing, since a popup closes whenever it loses focus", () => {
    expect(reportsClosing(false)).toBe(true);
    expect(reportsClosing(true)).toBe(false);
  });
});

describe("Safari manifest", () => {
  const safari = toSafariManifest(chromeManifest);

  it("swaps the side panel for a popup on the same page", () => {
    expect(safari["side_panel"]).toBeUndefined();
    expect(safari.permissions).not.toContain("sidePanel");
    expect(safari.action.default_popup).toBe("ui/panel.html");
    expect(safari.action.default_title).toBe("__MSG_extName__");
  });

  it("drops the Chrome-only version key and changes nothing else", () => {
    expect(safari["minimum_chrome_version"]).toBeUndefined();
    const changed = new Set(["side_panel", "minimum_chrome_version", "permissions", "action"]);
    for (const [key, value] of Object.entries(chromeManifest as Record<string, unknown>)) {
      if (!changed.has(key)) expect(safari[key], key).toEqual(value);
    }
    expect(safari.permissions).toEqual(["scripting", "storage"]);
  });

  it("leaves the Chrome manifest untouched and refuses one with no panel page", () => {
    expect((chromeManifest as { action: object }).action).not.toHaveProperty("default_popup");
    expect(() => toSafariManifest({ manifest_version: 3 })).toThrow(/side_panel/);
  });
});
