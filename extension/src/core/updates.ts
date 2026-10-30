// Update notices for installs that do not update themselves (unpacked ones). Pure rules only: which GitHub release is
// the newest extension release, whether it is newer than what is installed, and when the notice may be shown. The
// release list is data from the internet, so nothing in it is trusted beyond a tag name that matches a strict
// pattern; the link shown is built here from the checked version, never taken from the response.

/** The repository whose releases are checked. */
export const RELEASES_REPO = "imskaff/geniescraper";

/** The API address of the repository's releases (newest first; the extension and the desktop app share the list). */
export const RELEASES_API_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=30`;

/** Extension releases are tagged `extension-v<version>`; the desktop app's releases use other tags and are ignored. */
const TAG_PATTERN = /^extension-v((?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3})$/;

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

/** A version a notice may offer: the numbers of a Chrome extension version, such as "0.7.0". */
export function parseVersion(text: unknown): number[] | null {
  if (typeof text !== "string") return null;
  const match = /^((?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3})$/.exec(text);
  return match?.[1] ? match[1].split(".").map(Number) : null;
}

/** Negative when `a` is older than `b`, positive when newer, 0 when equal ("1.2" equals "1.2.0"). Null if either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The page of a release on GitHub, built from a checked version. */
export const releaseUrl = (version: string): string =>
  `https://github.com/${RELEASES_REPO}/releases/tag/extension-v${version}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * The newest installable extension release in GitHub's answer, as a version, or null when there is none.
 * A release counts only when its tag is `extension-v<version>`, it is neither a draft nor a pre-release, and it carries
 * the zip the README tells people to download. Anything malformed is skipped, never fatal.
 */
export function newestExtensionVersion(releases: unknown): string | null {
  if (!Array.isArray(releases)) return null;
  let newest: string | null = null;
  for (const release of releases as unknown[]) {
    if (!isRecord(release) || release["draft"] !== false || release["prerelease"] !== false) continue;
    const tag = release["tag_name"];
    const version = typeof tag === "string" ? TAG_PATTERN.exec(tag)?.[1] : undefined;
    if (!version) continue;
    const assets = release["assets"];
    const zip = `geniescraper-extension-${version}.zip`;
    if (!Array.isArray(assets) || !(assets as unknown[]).some((a) => isRecord(a) && a["name"] === zip)) continue;
    if (newest === null || (compareVersions(version, newest) ?? 0) > 0) newest = version;
  }
  return newest;
}

/** What the worker keeps between checks. All of it is the extension's own bookkeeping, nothing about the user. */
export interface UpdateRecord {
  /** When a check was last tried, success or not, so a failure is not retried at every panel opening. */
  checkedAt: number;
  /** The newest extension version found by the last successful check. */
  latest: string | null;
  /** "Later": the notice for this version stays hidden until this time. */
  snooze: { version: string; until: number } | null;
  /** "Skip this version": this version and every older one is never offered. */
  skipped: string | null;
}

export const EMPTY_UPDATE_RECORD: Readonly<UpdateRecord> = { checkedAt: 0, latest: null, snooze: null, skipped: null };

export const UPDATE_KEY = "updateCheck";

/** Whatever storage returns, made safe to use. */
export function normaliseUpdateRecord(raw: unknown): UpdateRecord {
  if (!isRecord(raw)) return { ...EMPTY_UPDATE_RECORD };
  const version = (value: unknown): string | null => (parseVersion(value) ? (value as string) : null);
  const time = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const snooze = raw["snooze"];
  const snoozeVersion = isRecord(snooze) ? version(snooze["version"]) : null;
  return {
    checkedAt: time(raw["checkedAt"]),
    latest: version(raw["latest"]),
    snooze: isRecord(snooze) && snoozeVersion ? { version: snoozeVersion, until: time(snooze["until"]) } : null,
    skipped: version(raw["skipped"]),
  };
}

/** Whether a check is due: none yet, a day has passed, or the clock was set back so the last one lies in the future. */
export function checkIsDue(record: UpdateRecord, now: number): boolean {
  return record.checkedAt <= 0 || now < record.checkedAt || now - record.checkedAt >= CHECK_INTERVAL_MS;
}

/** The record after a check. `found` is null when the answer was unusable: the last good answer is kept. */
export function afterCheck(record: UpdateRecord, now: number, found: string | null | undefined): UpdateRecord {
  return { ...record, checkedAt: now, latest: found === undefined || found === null ? record.latest : found };
}

export interface OfferedUpdate {
  version: string;
  url: string;
}

/** The update to show a notice for now, or null: nothing newer, skipped, or snoozed. */
export function offeredUpdate(record: UpdateRecord, installed: string, now: number): OfferedUpdate | null {
  const latest = record.latest;
  if (!latest || (compareVersions(latest, installed) ?? 0) <= 0) return null;
  if (record.skipped && (compareVersions(latest, record.skipped) ?? 1) <= 0) return null;
  if (record.snooze?.version === latest && now < record.snooze.until) return null;
  return { version: latest, url: releaseUrl(latest) };
}

/** "Later": hide the notice for this version for a few days; a newer version brings it back at once. */
export const snoozed = (record: UpdateRecord, version: string, now: number): UpdateRecord => ({
  ...record,
  snooze: { version, until: now + SNOOZE_MS },
});

/** "Skip this version": keep the newest of the skipped versions. */
export const skipped = (record: UpdateRecord, version: string): UpdateRecord => ({
  ...record,
  skipped: record.skipped && (compareVersions(record.skipped, version) ?? 0) > 0 ? record.skipped : version,
});

/**
 * Whether this install is one that never updates itself. A store install carries an `update_url` in its manifest and
 * is updated by the browser; an unpacked one does not. A browser without a side panel (Safari's popup build) is
 * updated by its own app, not by unzipping over a folder, so the notice is not offered there either.
 */
export function canCheckForUpdates(manifest: { update_url?: unknown }, hasSidePanel: boolean): boolean {
  return hasSidePanel && manifest.update_url === undefined;
}
