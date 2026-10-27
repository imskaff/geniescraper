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
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  scrapeCore: true,
  scrapeAdditional: true,
  scrapeCopyright: true,
  scrapeYoutube: true,
  scrapeCoverArt: true,
};

export const SETTINGS_KEY = "settings";

/** Every field of `raw` that is a boolean replaces its default; anything else is ignored. */
export function normaliseSettings(raw: unknown): Settings {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const pick = (key: keyof Settings): boolean => {
    const value = source[key];
    return typeof value === "boolean" ? value : DEFAULT_SETTINGS[key];
  };
  return {
    scrapeCore: pick("scrapeCore"),
    scrapeAdditional: pick("scrapeAdditional"),
    scrapeCopyright: pick("scrapeCopyright"),
    scrapeYoutube: pick("scrapeYoutube"),
    scrapeCoverArt: pick("scrapeCoverArt"),
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
