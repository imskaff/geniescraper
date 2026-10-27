import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

interface Manifest {
  manifest_version: number;
  name: string;
  version: string;
  description: string;
  default_locale?: string;
  permissions?: string[];
  optional_permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_security_policy?: unknown;
  web_accessible_resources?: unknown;
  externally_connectable?: unknown;
  background?: { service_worker?: string };
  side_panel?: { default_path?: string };
  content_scripts?: { matches: string[]; js?: string[] }[];
  icons?: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf-8")) as Manifest;
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { version: string };

// Every permission the extension may ever ask for, with the slice that adds it.
// Widening either list is a deliberate change: update docs/extension-plan.md section 5.2 with it.
const ALLOWED_PERMISSIONS = new Set(["storage", "scripting", "sidePanel"]);
const ALLOWED_HOSTS = new Set([
  "https://music.apple.com/*",
  "https://genius.com/*",
  "https://itunes.apple.com/*",
  "https://api.deezer.com/*",
  "https://www.youtube.com/*",
]);
const ALLOWED_OPTIONAL_HOSTS = new Set(["https://api.deezer.com/*", "https://www.youtube.com/*"]);

describe("manifest", () => {
  it("is Manifest V3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it("version matches package.json", () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it("keeps the default content security policy and exposes nothing to web pages", () => {
    expect(manifest.content_security_policy).toBeUndefined();
    expect(manifest.web_accessible_resources).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
  });

  it("only requests approved permissions", () => {
    for (const permission of manifest.permissions ?? []) {
      expect(ALLOWED_PERMISSIONS, `permission ${permission}`).toContain(permission);
    }
    expect(manifest.optional_permissions ?? []).toEqual([]);
  });

  it("only requests approved hosts, all https and none broad", () => {
    for (const host of manifest.host_permissions ?? []) {
      expect(ALLOWED_HOSTS, `host ${host}`).toContain(host);
    }
    for (const host of manifest.optional_host_permissions ?? []) {
      expect(ALLOWED_OPTIONAL_HOSTS, `optional host ${host}`).toContain(host);
    }
  });

  it("never matches every site", () => {
    const patterns = [
      ...(manifest.host_permissions ?? []),
      ...(manifest.optional_host_permissions ?? []),
      ...(manifest.content_scripts ?? []).flatMap((script) => script.matches),
    ];
    for (const pattern of patterns) {
      expect(pattern).toMatch(/^https:\/\/[a-z.]+\/\*$/);
    }
  });

  it("does not request the tabs permission", () => {
    expect(manifest.permissions ?? []).not.toContain("tabs");
  });
});

describe("manifest files", () => {
  it("references files that exist", () => {
    const referenced = [
      ...Object.values(manifest.icons ?? {}),
      ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? []),
    ];
    for (const path of referenced) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
    }
  });

  it("builds the service worker from a source module", () => {
    const worker = manifest.background?.service_worker;
    expect(worker).toBeDefined();
    const source = worker?.replace(/\.js$/, ".ts") ?? "";
    expect(existsSync(join(ROOT, "src", source)), source).toBe(true);
  });

  it("serves the side panel from a page the build copies", () => {
    const panel = manifest.side_panel?.default_path;
    expect(panel).toBe("ui/panel.html");
    const build = readFileSync(join(ROOT, "scripts", "build.mjs"), "utf-8");
    expect(build).toContain(`"src/${panel ?? ""}": "${panel ?? ""}"`);
    expect(existsSync(join(ROOT, "src", panel ?? ""))).toBe(true);
    // The page loads its script and stylesheet next to itself, so the build has to produce both.
    const html = readFileSync(join(ROOT, "src", panel ?? ""), "utf-8");
    expect(html).toContain('src="panel.js"');
    expect(build).toContain('"ui/panel": "src/ui/panel.ts"');
    expect(html).toContain('href="panel.css"');
    expect(build).toContain('"src/ui/panel.css": "ui/panel.css"');
  });

  it("loads no remote or inline code in the panel page", () => {
    const html = readFileSync(join(ROOT, "src", "ui", "panel.html"), "utf-8");
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
    expect(html).not.toMatch(/\son\w+=/);
  });

  it("has icons at 16, 48 and 128", () => {
    expect(Object.keys(manifest.icons ?? {}).sort()).toEqual(["128", "16", "48"]);
  });
});

describe("locales", () => {
  const messages = JSON.parse(readFileSync(join(ROOT, "_locales/en/messages.json"), "utf-8")) as Record<
    string,
    { message: string }
  >;

  it("defines every __MSG_ key used by the manifest", () => {
    const keys = JSON.stringify(manifest).match(/__MSG_(\w+)__/g) ?? [];
    expect(keys.length).toBeGreaterThan(0);
    for (const placeholder of keys) {
      expect(messages, placeholder).toHaveProperty(placeholder.slice(6, -2));
    }
  });

  it("keeps the description within the store's 132 character limit", () => {
    expect(messages["extDescription"]?.message.length).toBeLessThanOrEqual(132);
  });
});
