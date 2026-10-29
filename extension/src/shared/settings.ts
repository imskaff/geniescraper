// User settings: typed defaults, and a normaliser that makes whatever storage returns safe to use.
// Storage is outside the code's control (older versions, hand edits, sync from another device), so nothing read
// from it is trusted to have the right shape.
import type { QueueOptions } from "../core/models";

/** How a track's paste is started: by itself, or one Next-key press per step. */
export type PasteMode = "auto" | "manual";

export interface Settings {
  /** What the main Start pasting button does. */
  pasteMode: PasteMode;
  /** Which parts of a track's credits go into the paste queue. */
  scrapeCore: boolean;
  scrapeAdditional: boolean;
  scrapeCopyright: boolean;
  scrapeYoutube: boolean;
  scrapeCoverArt: boolean;
  scrapeReleaseDate: boolean;
  /** Keys pressed on the Genius page: fill the next step, and go back one. */
  nextHotkey: string;
  backHotkey: string;
  /** Choose the exact match in Genius's suggestions without asking. */
  autoConfirm: boolean;
  /** How long Genius's suggestions must hold still before they are trusted, in seconds. */
  autocompleteWaitSeconds: number;
  /** The pause between fields while pasting automatically, in seconds. */
  autoPaceSeconds: number;
  /** How many tracks are read at once; 0 reads every picked track at the same time. */
  parallelReads: number;
  /** Go back to the main menu a few seconds after the last step, as the desktop app does. */
  autoReturn: boolean;
  /** Seconds the finished screen waits before going back to the main menu. */
  returnSeconds: number;
  /** Seconds the finished screen waits before starting the next track by itself; 0 waits for the user. */
  nextTrackSeconds: number;
  /** The first-time set-up has been seen (finished or skipped). */
  onboarded: boolean;
}

/**
 * Keys the page can take over. Each one is acted on only while a paste session is running, and the browser's own
 * use of it (F7 is caret browsing in Chrome) is suppressed by the page handler for those presses.
 */
export const HOTKEY_CHOICES = ["F2", "F4", "F7", "F8", "F9"] as const;

/** Choices for reading tracks at once; 0 stands for all of them. Three is the default: a good speed-up that stays modest. */
export const PARALLEL_CHOICES = [1, 2, 3, 5, 0] as const;

export const WAIT_RANGE = { min: 0.2, max: 3 } as const;

/** The pause between fields in an automatic run: short enough to feel quick, long enough not to hammer Genius. */
export const PACE_RANGE = { min: 0.2, max: 5 } as const;

/** Whole seconds a countdown may hold for: long enough to look at the Genius form, short enough to stay useful. */
export const COUNTDOWN_RANGE = { min: 5, max: 120 } as const;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  pasteMode: "auto",
  scrapeCore: true,
  scrapeAdditional: true,
  scrapeCopyright: true,
  scrapeYoutube: true,
  scrapeCoverArt: true,
  scrapeReleaseDate: true,
  nextHotkey: "F8",
  backHotkey: "F7",
  autoConfirm: true,
  autocompleteWaitSeconds: 0.6,
  autoPaceSeconds: 0.6,
  parallelReads: 3,
  autoReturn: true,
  returnSeconds: 30,
  nextTrackSeconds: 0,
  onboarded: false,
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
  // Someone who already has saved settings from before the set-up existed has been using the extension: they are not
  // welcomed as a new user. Only an empty store, or one that says so, shows the set-up.
  const seen = source["onboarded"];
  const onboarded = typeof seen === "boolean" ? seen : Object.keys(source).length > 0;
  const wait = source["autocompleteWaitSeconds"];
  const waitSeconds =
    typeof wait === "number" && Number.isFinite(wait)
      ? Math.min(WAIT_RANGE.max, Math.max(WAIT_RANGE.min, wait))
      : DEFAULT_SETTINGS.autocompleteWaitSeconds;

  // Whole seconds inside the range; anything that is not a finite number is the default. Zero is allowed only where
  // it means "do not count down" (the next track), never for the return to the menu.
  const seconds = (key: "returnSeconds" | "nextTrackSeconds", allowZero: boolean): number => {
    const value = source[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SETTINGS[key];
    if (allowZero && value === 0) return 0;
    return Math.min(COUNTDOWN_RANGE.max, Math.max(COUNTDOWN_RANGE.min, Math.round(value)));
  };

  const mode = source["pasteMode"];
  const pasteMode: PasteMode = mode === "manual" ? "manual" : DEFAULT_SETTINGS.pasteMode;

  const pace = source["autoPaceSeconds"];
  const autoPaceSeconds =
    typeof pace === "number" && Number.isFinite(pace)
      ? Math.min(PACE_RANGE.max, Math.max(PACE_RANGE.min, pace))
      : DEFAULT_SETTINGS.autoPaceSeconds;

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
    pasteMode,
    scrapeCore: flag("scrapeCore"),
    scrapeAdditional: flag("scrapeAdditional"),
    scrapeCopyright: flag("scrapeCopyright"),
    scrapeYoutube: flag("scrapeYoutube"),
    scrapeCoverArt: flag("scrapeCoverArt"),
    scrapeReleaseDate: flag("scrapeReleaseDate"),
    nextHotkey,
    backHotkey,
    autoConfirm: flag("autoConfirm"),
    autocompleteWaitSeconds: waitSeconds,
    autoPaceSeconds,
    parallelReads,
    autoReturn: flag("autoReturn"),
    returnSeconds: seconds("returnSeconds", false),
    nextTrackSeconds: seconds("nextTrackSeconds", true),
    onboarded,
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
    includeReleaseDate: settings.scrapeReleaseDate,
  };
}
