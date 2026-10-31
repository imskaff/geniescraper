import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOOKUP_HOSTS } from "../src/lookups/http";
import { APPLE_PROVIDER } from "../src/providers/apple";
import { BRIDGE_HOST } from "../src/shared/bridge";

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
  content_scripts?: { matches: string[]; js?: string[]; all_frames?: boolean; run_at?: string }[];
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
  "https://open.spotify.com/*",
  "https://www.youtube.com/*",
  "https://www.googleapis.com/*",
]);
const ALLOWED_OPTIONAL_HOSTS = new Set([
  "https://open.spotify.com/*",
  "https://www.youtube.com/*",
  "https://www.googleapis.com/*",
]);

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

  it("grants every host a lookup may contact, required or optional", () => {
    const granted = [...(manifest.host_permissions ?? []), ...(manifest.optional_host_permissions ?? [])];
    for (const host of LOOKUP_HOSTS) expect(granted, host).toContain(`https://${host}/*`);
  });

  it("hardcodes no address in the lookup and worker code except for hosts the privacy policy names", () => {
    const policy = readFileSync(join(ROOT, "PRIVACY.md"), "utf-8");
    const folders = ["src/lookups", "src/background"];
    const found = new Set<string>();
    for (const folder of folders) {
      for (const file of readdirSync(join(ROOT, folder)).filter((name) => name.endsWith(".ts"))) {
        const code = readFileSync(join(ROOT, folder, file), "utf-8")
          .split("\n")
          .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
        for (const line of code) for (const m of line.matchAll(/https?:\/\/([a-z0-9.-]+)/g)) found.add(m[1] ?? "");
      }
    }
    // The scan must actually see the addresses, or the check below proves nothing.
    expect(found.size).toBeGreaterThanOrEqual(4);
    expect([...found].sort()).toEqual([...found].sort().filter((host) => policy.includes(host)));
    // Plain http would be readable on the way: every address is https.
    for (const folder of folders) {
      for (const file of readdirSync(join(ROOT, folder)).filter((name) => name.endsWith(".ts"))) {
        expect(readFileSync(join(ROOT, folder, file), "utf-8"), file).not.toMatch(/["'`]http:\/\//);
      }
    }
  });

  it("does not request the tabs permission", () => {
    expect(manifest.permissions ?? []).not.toContain("tabs");
  });
});

describe("manifest files", () => {
  it("references files that exist", () => {
    for (const path of Object.values(manifest.icons ?? {})) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
    }
  });

  it("builds every content script from a source module", () => {
    const build = readFileSync(join(ROOT, "scripts", "build.mjs"), "utf-8");
    const scripts = (manifest.content_scripts ?? []).flatMap((script) => script.js ?? []);
    expect(scripts.length).toBeGreaterThan(0);
    for (const path of scripts) {
      const source = `src/${path.replace(/\.js$/, ".ts")}`;
      expect(existsSync(join(ROOT, source)), source).toBe(true);
      expect(build, path).toContain(`"${path.replace(/\.js$/, "")}": "${source}"`);
    }
  });

  it("runs the Genius content script on genius.com only, in the top frame, after the page is idle", () => {
    const [script, ...others] = manifest.content_scripts ?? [];
    expect(others).toEqual([]);
    expect(script?.matches).toEqual(["https://genius.com/*"]);
    expect(script?.js).toEqual(["genius/content.js"]);
    expect(script?.all_frames).toBeUndefined();
    expect(script?.run_at).toBe("document_idle");
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

describe("the companion link to the desktop app", () => {
  const read = (path: string): string => readFileSync(join(ROOT, path), "utf-8");

  it("needs no permission of its own: no loopback host, no native messaging", () => {
    const all = [...(manifest.host_permissions ?? []), ...(manifest.optional_host_permissions ?? [])];
    expect(all.filter((host) => /127\.0\.0\.1|localhost|ws:|\[::1\]/.test(host))).toEqual([]);
    expect(manifest.permissions ?? []).not.toContain("nativeMessaging");
  });

  it("opens sockets to ws://127.0.0.1 and to no other socket address anywhere in the extension", () => {
    const found = new Set<string>();
    const walk = (folder: string): void => {
      for (const entry of readdirSync(join(ROOT, folder), { withFileTypes: true })) {
        const path = `${folder}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts")) {
          for (const m of read(path).matchAll(/wss?:\/\/([^\s"'`/:]+)/g)) found.add(m[1] ?? "");
        }
      }
    };
    walk("src");
    expect([...found]).toEqual(["${BRIDGE_HOST}"]);
    expect(BRIDGE_HOST).toBe("127.0.0.1");
    expect(read("src/background/bridge.ts")).not.toContain("wss://");
  });

  it("is named in the privacy policy and the store listing", () => {
    expect(read("PRIVACY.md")).toContain("127.0.0.1");
    expect(read("store/listing.md")).toContain("127.0.0.1");
  });

  it("says in the privacy policy and the store listing that open Apple Music pages go to the desktop app", () => {
    expect(read("PRIVACY.md")).toContain("title and address of each such page");
    expect(read("PRIVACY.md")).toContain("does not list or send any other tab");
    expect(read("store/listing.md")).toContain(
      "titles and addresses of the user's open Apple Music album and song pages",
    );
  });

  it("asks for no permission to list the open Apple Music pages", () => {
    const manifest = JSON.parse(read("manifest.json")) as { permissions: string[]; host_permissions: string[] };
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.host_permissions).toContain("https://music.apple.com/*");
    // The desktop link lists Apple Music tabs only (it cannot read other sources), by address filter.
    expect(read("src/background/worker.ts")).toContain("chrome.tabs.query({ url: [...APPLE_PROVIDER.origins] })");
    expect(APPLE_PROVIDER.origins).toEqual(["https://music.apple.com/*"]);
  });

  it("keeps the secret out of the synced area and out of logs", () => {
    const source = read("src/background/bridge.ts");
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/storage\.sync/);
    expect(read("src/background/worker.ts")).toContain("chrome.storage.local");
  });
});
