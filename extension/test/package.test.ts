import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript build helpers, with no type declarations
import { createZip, crc32 } from "../scripts/lib/zip.mjs";
// @ts-expect-error - plain JavaScript build helpers, with no type declarations
import { MAX_DESCRIPTION_CHARS, pngSize, validateDist } from "../scripts/lib/validate-dist.mjs";

interface ZipEntry {
  name: string;
  data: Uint8Array;
}
declare function createZip(entries: ZipEntry[]): Buffer;
declare function crc32(data: Uint8Array): number;
declare function validateDist(dist: string, version?: string): string[];
declare function pngSize(buffer: Buffer): { width: number; height: number } | null;
declare const MAX_DESCRIPTION_CHARS: number;

/** Read a zip back the way an unzipper does: from the central directory, checking every CRC. */
function readZip(zip: Buffer): Record<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const raw = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const body = zip.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(body) : body;
    expect(data.length, name).toBe(raw);
    expect(crc32(data), name).toBe(crc);
    out[name] = Buffer.from(data);
    at += 46 + nameLength;
  }
  return out;
}

describe("the zip writer", () => {
  it("round-trips every file, deflated or stored, with correct sizes and checksums", () => {
    const big = Buffer.from("credits ".repeat(5000));
    const small = Buffer.from("x");
    const unicode = Buffer.from("Géniescraper");
    const files = readZip(
      createZip([
        { name: "b/big.txt", data: big },
        { name: "a.txt", data: small },
        { name: "_locales/en/é.json", data: unicode },
        { name: "empty.txt", data: Buffer.alloc(0) },
      ]),
    );
    expect(Object.keys(files)).toEqual(["_locales/en/é.json", "a.txt", "b/big.txt", "empty.txt"]);
    expect(files["b/big.txt"]?.equals(big)).toBe(true);
    expect(files["a.txt"]?.equals(small)).toBe(true);
    expect(files["_locales/en/é.json"]?.equals(unicode)).toBe(true);
    expect(files["empty.txt"]?.length).toBe(0);
  });

  it("gives the same bytes whatever the order the files come in", () => {
    const a = { name: "a.txt", data: Buffer.from("one") };
    const b = { name: "b.txt", data: Buffer.from("two") };
    expect(createZip([a, b]).equals(createZip([b, a]))).toBe(true);
  });

  it("deflates what compresses and stores what does not", () => {
    const text = Buffer.from("a".repeat(10_000));
    expect(createZip([{ name: "t.txt", data: text }]).length).toBeLessThan(text.length / 10);
  });

  it.each(["/abs.txt", "../up.txt", "a/../b.txt", "back\\slash.txt"])("refuses the unsafe name %j", (name) => {
    expect(() => createZip([{ name, data: Buffer.from("x") }])).toThrow("Unsafe zip entry name");
  });

  it("computes the standard CRC-32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

/** A PNG header of the given size: enough for a dimension check. */
const png = (size: number): Buffer => {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  Buffer.from("IHDR", "ascii").copy(header, 12);
  header.writeUInt32BE(size, 16);
  header.writeUInt32BE(size, 20);
  return header;
};

const GOOD_MANIFEST = {
  manifest_version: 3,
  name: "__MSG_extName__",
  version: "1.2.3",
  description: "__MSG_extDescription__",
  default_locale: "en",
  icons: { "16": "icons/icon-16.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" },
  action: { default_icon: { "16": "icons/icon-16.png" } },
  side_panel: { default_path: "ui/panel.html" },
  background: { service_worker: "background/worker.js" },
  content_scripts: [{ matches: ["https://genius.com/*"], js: ["genius/content.js"] }],
};
const GOOD_FILES: Record<string, string | Buffer> = {
  "manifest.json": JSON.stringify(GOOD_MANIFEST),
  "_locales/en/messages.json": JSON.stringify({
    extName: { message: "Name" },
    extDescription: { message: "A short description." },
  }),
  "icons/icon-16.png": png(16),
  "icons/icon-48.png": png(48),
  "icons/icon-128.png": png(128),
  "ui/panel.html": '<!doctype html><link rel="stylesheet" href="panel.css"><script src="panel.js"></script>',
  "ui/panel.js": "console.log(1);",
  "background/worker.js": "console.log(2);",
  "genius/content.js": "console.log(3);",
};

const made: string[] = [];
function dist(overrides: Record<string, string | Buffer | null> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "gs-dist-"));
  made.push(root);
  for (const [path, content] of Object.entries({ ...GOOD_FILES, ...overrides })) {
    if (content === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the package check", () => {
  it("passes a good package", () => {
    expect(validateDist(dist(), "1.2.3")).toEqual([]);
  });

  it("says the build folder is missing", () => {
    expect(validateDist(join(tmpdir(), "gs-no-such-folder"))[0]).toContain("Run npm run build first");
  });

  it.each([
    ["a manifest that is not JSON", { "manifest.json": "{" }, "not valid JSON"],
    [
      "a locale file that is not JSON",
      { "_locales/en/messages.json": "{" },
      "_locales/en/messages.json is not valid JSON",
    ],
    [
      "manifest version 2",
      { "manifest.json": JSON.stringify({ ...GOOD_MANIFEST, manifest_version: 2 }) },
      "manifest_version must be 3",
    ],
    [
      "a version that is not Chrome's kind",
      { "manifest.json": JSON.stringify({ ...GOOD_MANIFEST, version: "1.2.3-beta" }) },
      "is not a Chrome version",
    ],
    [
      "a version that differs from package.json",
      { "manifest.json": JSON.stringify({ ...GOOD_MANIFEST, version: "9.9.9" }) },
      "differs from package.json",
    ],
    ["a missing locale file", { "_locales/en/messages.json": null }, "messages.json is missing"],
    [
      "a missing description message",
      { "_locales/en/messages.json": JSON.stringify({ extName: { message: "N" } }) },
      'no "extDescription"',
    ],
    [
      "a description over the store limit",
      {
        "_locales/en/messages.json": JSON.stringify({
          extName: { message: "N" },
          extDescription: { message: "x".repeat(MAX_DESCRIPTION_CHARS + 1) },
        }),
      },
      "the store allows",
    ],
    ["a missing icon", { "icons/icon-48.png": null }, "icons/icon-48.png is missing"],
    ["an icon that is not a PNG", { "icons/icon-16.png": "GIF89a" }, "is not a PNG"],
    ["an icon of the wrong size", { "icons/icon-128.png": png(64) }, "is 64x64, not 128x128"],
    ["a missing service worker", { "background/worker.js": null }, "background/worker.js, which is not in the package"],
    ["a missing content script", { "genius/content.js": null }, "genius/content.js, which is not in the package"],
    ["a missing side panel page", { "ui/panel.html": null }, "ui/panel.html, which is not in the package"],
    ["a source map", { "ui/panel.js.map": "{}" }, "should not be in the package"],
    ["a TypeScript file", { "src/x.ts": "export {}" }, "should not be in the package"],
    ["a test file", { "test/a.test.js": "x" }, "should not be in the package"],
    ["a notes file", { "NOTES.md": "x" }, "should not be in the package"],
    ["an empty script", { "ui/panel.js": "  \n" }, "is empty"],
    ["eval", { "ui/panel.js": "eval('1')" }, "contains eval()"],
    ["new Function", { "ui/panel.js": "new Function('x')" }, "contains new Function()"],
    ["an innerHTML assignment", { "ui/panel.js": "node.innerHTML = x" }, "innerHTML assignment"],
    ["insertAdjacentHTML", { "ui/panel.js": "n.insertAdjacentHTML('a', x)" }, "insertAdjacentHTML()"],
    ["a remote script", { "ui/panel.html": '<script src="https://evil.example/x.js"></script>' }, "remote address"],
    [
      "a protocol-relative remote script",
      { "ui/panel.html": '<script src="//evil.example/x.js"></script>' },
      "remote address",
    ],
    ["an inline script", { "ui/panel.html": "<script>alert(1)</script>" }, "inline script"],
  ] as const)("fails %s", (_name, overrides, words) => {
    const problems = validateDist(dist(overrides), "1.2.3");
    expect(problems.join("\n")).toContain(words);
  });

  it("fails a package over the size limit", () => {
    const problems = validateDist(dist({ "ui/panel.js": "x".repeat(11 * 1024 * 1024) }), "1.2.3");
    expect(problems.join("\n")).toContain("bytes; the limit");
  });
});

describe("pngSize", () => {
  it("reads the size from the header, and rejects anything else", () => {
    expect(pngSize(png(48))).toEqual({ width: 48, height: 48 });
    expect(pngSize(Buffer.from("not a png at all, but long enough to read"))).toBeNull();
    expect(pngSize(Buffer.alloc(4))).toBeNull();
  });
});

describe("the store listing and privacy policy", () => {
  const root = join(import.meta.dirname, "..");
  const read = (path: string): string => readFileSync(join(root, path), "utf-8");
  const manifest = JSON.parse(read("manifest.json")) as {
    permissions: string[];
    host_permissions: string[];
    optional_host_permissions: string[];
  };
  const listing = read("store/listing.md");
  const privacy = read("PRIVACY.md");
  const locale = JSON.parse(read("_locales/en/messages.json")) as Record<string, { message: string }>;

  it("justifies every permission and host the manifest asks for, and none it does not", () => {
    const rows = [...listing.matchAll(/^\| (.+?) \| .+ \|$/gm)].map((m) => m[1] ?? "");
    const justified = rows
      .map((cell) => /`([^`]+)`/.exec(cell)?.[1])
      .filter((value): value is string => value !== undefined);
    const asked = [...manifest.permissions, ...manifest.host_permissions, ...manifest.optional_host_permissions];
    expect(justified.sort()).toEqual(asked.sort());
  });

  it("marks the optional hosts as optional and says they are requested only on request", () => {
    for (const host of manifest.optional_host_permissions) {
      const row = listing.split("\n").find((line) => line.includes(`\`${host}\``)) ?? "";
      expect(row, host).toContain("Optional host");
      expect(row, host).toContain("only when");
    }
  });

  it("has the short description the manifest ships, within the store limit", () => {
    const short = /## Short description[^\n]*\n\n(.+)\n/.exec(listing)?.[1];
    expect(short).toBe(locale["extDescription"]?.message);
    expect((short ?? "").length).toBeLessThanOrEqual(132);
  });

  it("names the extension as the manifest does, and states a single purpose", () => {
    expect(/## Name\n\n(.+)\n/.exec(listing)?.[1]).toBe(locale["extName"]?.message);
    expect(listing).toContain("## Single purpose");
    expect(listing).toContain("## Remote code");
  });

  it("tells the user about every host the extension can contact", () => {
    for (const pattern of [...manifest.host_permissions, ...manifest.optional_host_permissions]) {
      const host = pattern.replace("https://", "").replace("/*", "");
      if (host === "music.apple.com" || host === "genius.com") continue;
      expect(privacy, host).toContain(host);
    }
    for (const host of ["music.apple.com", "genius.com"]) expect(privacy).toContain(host);
  });

  it("promises no collection, no analytics, no remote code, and no automatic saving", () => {
    for (const phrase of [
      "collects nothing",
      "no analytics",
      "does not load or run code from the internet",
      "never presses Save",
    ]) {
      expect(privacy.toLowerCase(), phrase).toContain(phrase.toLowerCase());
    }
  });
});
