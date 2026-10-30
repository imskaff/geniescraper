import { describe, expect, it } from "vitest";
import {
  CHECK_INTERVAL_MS,
  EMPTY_UPDATE_RECORD,
  SNOOZE_MS,
  afterCheck,
  checkIsDue,
  compareVersions,
  newestExtensionVersion,
  normaliseUpdateRecord,
  offeredUpdate,
  parseVersion,
  releaseUrl,
  skipped,
  snoozed,
  type UpdateRecord,
} from "../../src/core/updates";

const release = (tag: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => {
  const version = typeof tag === "string" ? tag.replace(/^extension-v/, "") : "";
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: [{ name: `geniescraper-extension-${version}.zip` }, { name: "SHA256SUMS.txt" }],
    ...extra,
  };
};

const record = (patch: Partial<UpdateRecord> = {}): UpdateRecord => ({ ...EMPTY_UPDATE_RECORD, ...patch });

describe("parseVersion", () => {
  it.each([
    ["0.6.0", [0, 6, 0]],
    ["1", [1]],
    ["10.20.30.40", [10, 20, 30, 40]],
  ])("reads %s", (text, parts) => {
    expect(parseVersion(text)).toEqual(parts);
  });

  it.each(["", "v1.2.0", "1.2.3.4.5", "01.2", "1..2", "1.2-beta", "1.2.0 ", " 1.2", "a.b", "1.2.x", "99999999.0"])(
    "refuses %j",
    (text) => {
      expect(parseVersion(text)).toBeNull();
    },
  );

  it("refuses what is not text", () => {
    expect(parseVersion(1.2)).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });

  it("treats missing parts as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0.1", "1.2")).toBeGreaterThan(0);
    expect(compareVersions("1", "1.0.0.0")).toBe(0);
  });

  it("is null when either side is not a version", () => {
    expect(compareVersions("1.2.0", "latest")).toBeNull();
    expect(compareVersions("", "1.0.0")).toBeNull();
  });
});

describe("releaseUrl", () => {
  it("points at the release page in this repository", () => {
    expect(releaseUrl("0.7.0")).toBe("https://github.com/imskaff/geniescraper/releases/tag/extension-v0.7.0");
  });
});

describe("newestExtensionVersion", () => {
  it("picks the highest extension release whatever the order", () => {
    const list = [release("extension-v0.6.0"), release("extension-v0.10.0"), release("extension-v0.9.1")];
    expect(newestExtensionVersion(list)).toBe("0.10.0");
    expect(newestExtensionVersion([...list].reverse())).toBe("0.10.0");
  });

  it("ignores the desktop app releases, even when their number is higher", () => {
    const list = [release("v9.9"), release("desktop-v5.0.0"), release("extension-v0.6.0")];
    expect(newestExtensionVersion(list)).toBe("0.6.0");
  });

  it("is null when no release is for the extension", () => {
    expect(newestExtensionVersion([release("v1.2"), release("v1.3")])).toBeNull();
    expect(newestExtensionVersion([])).toBeNull();
  });

  it("skips drafts and pre-releases", () => {
    const list = [
      release("extension-v1.0.0", { draft: true }),
      release("extension-v0.9.0", { prerelease: true }),
      release("extension-v0.6.0"),
    ];
    expect(newestExtensionVersion(list)).toBe("0.6.0");
  });

  it.each([
    "extension-v1.0.0-beta",
    "extension-v1.0.0-rc.1",
    "extension-v01.2.0",
    "extension-v1.2.0 ",
    " extension-v1.2.0",
    "extension-v",
    "extension-v1.2.3.4.5",
    "Extension-v1.2.0",
    "extension-1.2.0",
    "extension-v1.2.0+build",
    "xextension-v1.2.0",
    "extension-v1.2.0\nextension-v9.9.9",
  ])("skips the odd tag %j", (tag) => {
    expect(newestExtensionVersion([release(tag), release("extension-v0.6.0")])).toBe("0.6.0");
  });

  it("needs the zip the README tells people to download", () => {
    const noAssets = release("extension-v1.0.0", { assets: [] });
    const wrongZip = release("extension-v1.1.0", { assets: [{ name: "geniescraper-extension-9.9.9.zip" }] });
    const missing = release("extension-v1.2.0", { assets: undefined });
    expect(newestExtensionVersion([noAssets, wrongZip, missing, release("extension-v0.6.0")])).toBe("0.6.0");
  });

  it("never fails on a malformed answer", () => {
    for (const bad of [null, undefined, "x", 3, {}, { message: "Not Found" }, [null, 1, "x", [], {}]]) {
      expect(newestExtensionVersion(bad)).toBeNull();
    }
    const odd = [
      { tag_name: 5, draft: false, prerelease: false, assets: [] },
      { tag_name: "extension-v1.0.0" },
      { ...release("extension-v2.0.0"), draft: "no" },
      { ...release("extension-v3.0.0"), assets: "zip" },
      { ...release("extension-v4.0.0"), assets: [null, 4, { name: 7 }] },
      release("extension-v0.6.0"),
    ];
    expect(newestExtensionVersion(odd)).toBe("0.6.0");
  });
});

describe("normaliseUpdateRecord", () => {
  it("falls back to the empty record", () => {
    for (const bad of [undefined, null, "x", 3, []]) expect(normaliseUpdateRecord(bad)).toEqual(EMPTY_UPDATE_RECORD);
  });

  it("keeps good values and drops bad ones one by one", () => {
    expect(
      normaliseUpdateRecord({
        checkedAt: 5,
        latest: "1.2.0",
        snooze: { version: "1.2.0", until: 9 },
        skipped: "1.0.0",
      }),
    ).toEqual({ checkedAt: 5, latest: "1.2.0", snooze: { version: "1.2.0", until: 9 }, skipped: "1.0.0" });
    expect(
      normaliseUpdateRecord({ checkedAt: "now", latest: "<script>", snooze: { version: "x", until: 1 }, skipped: 4 }),
    ).toEqual(EMPTY_UPDATE_RECORD);
    expect(normaliseUpdateRecord({ checkedAt: Number.NaN }).checkedAt).toBe(0);
  });
});

describe("checkIsDue", () => {
  it("is due when never checked", () => {
    expect(checkIsDue(record(), 1000)).toBe(true);
  });

  it("waits a full day after a check", () => {
    const base = record({ checkedAt: 1_000_000 });
    expect(checkIsDue(base, 1_000_000 + CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(checkIsDue(base, 1_000_000 + CHECK_INTERVAL_MS)).toBe(true);
  });

  it("is due again when the clock was set back", () => {
    expect(checkIsDue(record({ checkedAt: 5_000_000 }), 1_000_000)).toBe(true);
  });
});

describe("afterCheck", () => {
  it("stores the version found and the time", () => {
    expect(afterCheck(record(), 42, "0.7.0")).toMatchObject({ checkedAt: 42, latest: "0.7.0" });
  });

  it("on a failure keeps the last good answer but still notes the attempt", () => {
    const after = afterCheck(record({ latest: "0.7.0", checkedAt: 1 }), 42, null);
    expect(after).toMatchObject({ checkedAt: 42, latest: "0.7.0" });
  });

  it("keeps the choices the user made", () => {
    const base = record({ skipped: "0.5.0", snooze: { version: "0.7.0", until: 99 } });
    expect(afterCheck(base, 1, "0.8.0")).toMatchObject({ skipped: "0.5.0", snooze: { version: "0.7.0", until: 99 } });
  });
});

describe("offeredUpdate", () => {
  it("offers a newer version with its release page", () => {
    expect(offeredUpdate(record({ latest: "0.7.0" }), "0.6.0", 0)).toEqual({
      version: "0.7.0",
      url: releaseUrl("0.7.0"),
    });
  });

  it("offers nothing when the installed version is current, newer or unknown", () => {
    expect(offeredUpdate(record({ latest: "0.6.0" }), "0.6.0", 0)).toBeNull();
    expect(offeredUpdate(record({ latest: "0.6.0" }), "0.7.0", 0)).toBeNull();
    expect(offeredUpdate(record({ latest: "0.6" }), "0.6.0", 0)).toBeNull();
    expect(offeredUpdate(record(), "0.6.0", 0)).toBeNull();
  });

  it("does not offer a version that is skipped, or any older one, but offers a newer one", () => {
    const base = record({ latest: "0.7.0", skipped: "0.7.0" });
    expect(offeredUpdate(base, "0.6.0", 0)).toBeNull();
    expect(offeredUpdate({ ...base, skipped: "0.8.0" }, "0.6.0", 0)).toBeNull();
    expect(offeredUpdate({ ...base, latest: "0.7.1" }, "0.6.0", 0)?.version).toBe("0.7.1");
  });

  it("stays quiet while snoozed, returns afterwards, and returns at once for a newer version", () => {
    const base = snoozed(record({ latest: "0.7.0" }), "0.7.0", 1000);
    expect(offeredUpdate(base, "0.6.0", 1000 + SNOOZE_MS - 1)).toBeNull();
    expect(offeredUpdate(base, "0.6.0", 1000 + SNOOZE_MS)?.version).toBe("0.7.0");
    expect(offeredUpdate({ ...base, latest: "0.7.1" }, "0.6.0", 1001)?.version).toBe("0.7.1");
  });
});

describe("skipped", () => {
  it("remembers the version", () => {
    expect(skipped(record(), "0.7.0").skipped).toBe("0.7.0");
  });

  it("never lowers what was skipped", () => {
    expect(skipped(record({ skipped: "0.9.0" }), "0.7.0").skipped).toBe("0.9.0");
    expect(skipped(record({ skipped: "0.7.0" }), "0.9.0").skipped).toBe("0.9.0");
  });
});
