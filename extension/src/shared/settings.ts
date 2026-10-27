// User settings: typed defaults, and a normaliser that makes whatever storage returns safe to use.
// Storage is outside the code's control (older versions, hand edits, sync from another device), so nothing read
// from it is trusted to have the right shape.
import type { QueueOptions } from "../core/models";

export interface Settings {
  /** Which parts of a track's credits go into the paste queue. */
  scrapeCore: boolean;
  scrapeAdditional: boolean;
  scrapeCopyright: boolean;
  scrapeYoutube: boolean;
  scrapeCoverArt: boolean;
  /** Keys pressed on the Genius page: fill the next step, and go back one. */
  nextHotkey: string;
  backHotkey: string;
  /** Choose the exact match in Genius's suggestions without asking. */
  autoConfirm: boolean;
  /** How long Genius's suggestions must hold still before they are trusted, in seconds. */
  autocompleteWaitSeconds: number;
  /** How many tracks are read at once; 0 reads every picked track at the same time. */
  parallelReads: number;
}

/**
 * Keys the page can take over. Each one is acted on only while a paste session is running, and the browser's own
 * use of it (F7 is caret browsing in Chrome) is suppressed by the page handler for those presses.
 */
export const HOTKEY_CHOICES = ["F2", "F4", "F7", "F8", "F9"] as const;

/** Choices for reading tracks at once; 0 stands for all of them. Three is the default: a good speed-up that stays modest. */
export const PARALLEL_CHOICES = [1, 2, 3, 5, 0] as const;

export const WAIT_RANGE = { min: 0.2, max: 3 } as const;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  scrapeCore: true,
  scrapeAdditional: true,
  scrapeCopyright: true,
  scrapeYoutube: true,
  scrapeCoverArt: true,
  nextHotkey: "F8",
  backHotkey: "F7",
  autoConfirm: true,
  autocompleteWaitSeconds: 0.6,
  parallelReads: 3,
};

export const SETTINGS_KEY = "settings";

type BooleanKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

/** Every field of `raw` that is valid replaces its default; anything else is ignored. */
export function normaliseSettings(raw: unknown): Settings {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const flag = (key: BooleanKey): boolean => {
    const value = source[key];
    return typeof value === "boolean" ? value : DEFAULT_SETTINGS[key];
  };
  const hotkey = (key: "nextHotkey" | "backHotkey"): string => {
    const value = source[key];
    return typeof value === "string" && (HOTKEY_CHOICES as readonly string[]).includes(value)
      ? value
      : DEFAULT_SETTINGS[key];
  };
  const wait = source["autocompleteWaitSeconds"];
  const waitSeconds =
    typeof wait === "number" && Number.isFinite(wait)
      ? Math.min(WAIT_RANGE.max, Math.max(WAIT_RANGE.min, wait))
      : DEFAULT_SETTINGS.autocompleteWaitSeconds;

  const reads = source["parallelReads"];
  const parallelReads =
    typeof reads === "number" && (PARALLEL_CHOICES as readonly number[]).includes(reads)
      ? reads
      : DEFAULT_SETTINGS.parallelReads;

  let nextHotkey = hotkey("nextHotkey");
  let backHotkey = hotkey("backHotkey");
  // One key cannot do two things: fall back to the defaults rather than guess which was meant.
  if (nextHotkey === backHotkey) {
    nextHotkey = DEFAULT_SETTINGS.nextHotkey;
    backHotkey = DEFAULT_SETTINGS.backHotkey;
  }
  return {
    scrapeCore: flag("scrapeCore"),
    scrapeAdditional: flag("scrapeAdditional"),
    scrapeCopyright: flag("scrapeCopyright"),
    scrapeYoutube: flag("scrapeYoutube"),
    scrapeCoverArt: flag("scrapeCoverArt"),
    nextHotkey,
    backHotkey,
    autoConfirm: flag("autoConfirm"),
    autocompleteWaitSeconds: waitSeconds,
    parallelReads,
  };
}

/** The paste-queue options a set of settings stands for. */
export function queueOptions(settings: Settings): Required<QueueOptions> {
  return {
    includeCore: settings.scrapeCore,
    includeAdditional: settings.scrapeAdditional,
    includeCopyright: settings.scrapeCopyright,
    includeYoutube: settings.scrapeYoutube,
    includeCoverArt: settings.scrapeCoverArt,
  };
}
