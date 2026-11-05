import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript build helper, with no type declarations
import { FIREFOX_MIN_VERSION, GECKO_ID, toFirefoxManifest } from "../scripts/lib/firefox-manifest.mjs";

declare const FIREFOX_MIN_VERSION: string;
declare const GECKO_ID: string;
interface FirefoxManifest {
  [key: string]: unknown;
  sidebar_action: unknown;
  permissions: string[];
  browser_specific_settings: {
    gecko: {
      id: string;
      strict_min_version: string;
      data_collection_permissions: { required: string[]; optional?: string[] };
    };
  };
}
declare function toFirefoxManifest(manifest: unknown): FirefoxManifest;

const chromeManifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "manifest.json"), "utf-8")) as Record<
  string,
  unknown
> & { action: { default_icon: unknown } };

describe("Firefox manifest", () => {
  const firefox = toFirefoxManifest(chromeManifest);

  it("swaps the service worker for an event page and the side panel for the sidebar", () => {
    expect(firefox["background"]).toEqual({ scripts: ["background/worker.js"] });
    expect(firefox["side_panel"]).toBeUndefined();
    expect(firefox["minimum_chrome_version"]).toBeUndefined();
    expect(firefox["permissions"]).not.toContain("sidePanel");
    expect(firefox["permissions"]).toContain("storage");
    expect(firefox["sidebar_action"]).toEqual({
      default_panel: "ui/panel.html",
      default_title: "__MSG_extName__",
      default_icon: chromeManifest.action.default_icon,
    });
  });

  it("declares the id, the oldest Firefox and the data collection", () => {
    const gecko = firefox.browser_specific_settings.gecko;
    expect(gecko.id).toBe(GECKO_ID);
    expect(gecko.strict_min_version).toBe(FIREFOX_MIN_VERSION);
    expect(Array.isArray(gecko.data_collection_permissions.required)).toBe(true);
  });

  it("declares real Mozilla data types and never claims to collect nothing", () => {
    const allowed = new Set([
      "personallyIdentifyingInfo",
      "healthInfo",
      "financialAndPaymentInfo",
      "authenticationInfo",
      "personalCommunications",
      "locationInfo",
      "browsingActivity",
      "websiteContent",
      "websiteActivity",
      "searchTerms",
      "bookmarksInfo",
    ]);
    const { required, optional } = firefox.browser_specific_settings.gecko.data_collection_permissions;
    expect(required.length).toBeGreaterThan(0);
    for (const type of [...required, ...(optional ?? [])]) expect(allowed.has(type)).toBe(true);
  });

  it("keeps hosts, content scripts and everything else as they are", () => {
    const changed = new Set([
      "background",
      "side_panel",
      "minimum_chrome_version",
      "permissions",
      "sidebar_action",
      "browser_specific_settings",
    ]);
    for (const [key, value] of Object.entries(chromeManifest)) {
      if (!changed.has(key)) expect(firefox[key]).toEqual(value);
    }
  });

  it("does not change the manifest it is given", () => {
    const before = JSON.stringify(chromeManifest);
    toFirefoxManifest(chromeManifest);
    expect(JSON.stringify(chromeManifest)).toBe(before);
  });

  it("refuses a manifest with nothing to turn into a sidebar or an event page", () => {
    expect(() => toFirefoxManifest({ ...chromeManifest, side_panel: undefined })).toThrow("side_panel");
    expect(() => toFirefoxManifest({ ...chromeManifest, background: {} })).toThrow("service_worker");
  });
});
