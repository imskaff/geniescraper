// The update notice's worker side: at most one look at the project's releases per day, only while the user has
// switched it on and allowed the host, best effort and silent on any failure. What it learns is kept in local storage
// so the answer is the same however often the panel is opened. Nothing is downloaded or installed: the panel shows a
// link and the user does the rest by hand.
import {
  RELEASES_API_URL,
  UPDATE_KEY,
  afterCheck,
  checkIsDue,
  newestExtensionVersion,
  normaliseUpdateRecord,
  offeredUpdate,
  skipped,
  snoozed,
  type OfferedUpdate,
  type UpdateRecord,
} from "../core/updates";
import { SETTINGS_KEY, normaliseSettings } from "../shared/settings";
import type { KeyValueStore } from "../shared/storage";
import type { GetResult } from "../lookups/http";

export interface UpdateService {
  /** The notice to show now, or null. Looks at GitHub first when a look is due, or `force` (the user just switched it on). */
  check(force?: boolean): Promise<OfferedUpdate | null>;
  /** "Later": hide this version for a few days. */
  later(version: string): Promise<OfferedUpdate | null>;
  /** "Skip this version": never offer it, or any older one. */
  skip(version: string): Promise<OfferedUpdate | null>;
}

export const NO_UPDATES: UpdateService = {
  check: () => Promise.resolve(null),
  later: () => Promise.resolve(null),
  skip: () => Promise.resolve(null),
};

export interface UpdateDeps {
  /** The synced settings, to see whether the user switched the check on. */
  settings: KeyValueStore;
  /** This device's own storage, for the record of what was found. */
  local: KeyValueStore;
  /** A fetch that only goes out while the user has granted the host. */
  getResult: GetResult;
  /** Whether the user has granted the GitHub host right now. */
  granted(): Promise<boolean>;
  /** The version in the installed manifest. */
  installed: string;
  /** False for an install the browser updates by itself. */
  eligible: boolean;
  now(): number;
}

export function createUpdateService(deps: UpdateDeps): UpdateService {
  let inFlight: Promise<OfferedUpdate | null> | null = null;

  const load = async (): Promise<UpdateRecord> => normaliseUpdateRecord(await deps.local.get(UPDATE_KEY));
  const save = (record: UpdateRecord): Promise<void> => deps.local.set(UPDATE_KEY, record);

  async function enabled(): Promise<boolean> {
    if (!deps.eligible) return false;
    const settings = normaliseSettings(await deps.settings.get(SETTINGS_KEY));
    return settings.checkUpdates && (await deps.granted());
  }

  /** Ask GitHub; the version found, or null when the answer was unusable (a limit, no network, a changed format). */
  async function ask(): Promise<string | null> {
    const answer = await deps.getResult(RELEASES_API_URL, { accept: "application/vnd.github+json" });
    return answer?.status === 200 ? newestExtensionVersion(answer.body) : null;
  }

  async function run(force: boolean): Promise<OfferedUpdate | null> {
    if (!(await enabled())) return null;
    let record = await load();
    if (force || checkIsDue(record, deps.now())) {
      // The attempt is recorded even when it fails, so a limit or a lost connection is not retried at every opening.
      record = afterCheck(record, deps.now(), await ask());
      await save(record);
    }
    return offeredUpdate(record, deps.installed, deps.now());
  }

  /** Never throws and never waits on a second look: callers get the one in progress. */
  const guarded = (force: boolean): Promise<OfferedUpdate | null> => {
    inFlight ??= run(force)
      .catch(() => null)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  async function choose(change: (record: UpdateRecord) => UpdateRecord): Promise<OfferedUpdate | null> {
    try {
      const record = change(await load());
      await save(record);
      return offeredUpdate(record, deps.installed, deps.now());
    } catch {
      return null;
    }
  }

  return {
    check: (force = false) => guarded(force),
    later: (version) => choose((record) => snoozed(record, version, deps.now())),
    skip: (version) => choose((record) => skipped(record, version)),
  };
}
