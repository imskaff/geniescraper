// Port of assistant.flow: the per-step instruction text and the Auto-Tab key steps.
import type { QueueItem } from "./models";

/** Kinds whose value is copied as-is, with no autocomplete to confirm. */
export const CLIPBOARD_ONLY_KINDS: ReadonlySet<string> = new Set(["cover_art", "youtube_url"]);

/** A key to press and the pause, in seconds, to wait before pressing it. */
export type KeyStep = readonly [key: string, delaySeconds: number];

function tabs(count: number): KeyStep[] {
  return [["tab", 0.15], ...Array.from({ length: count - 1 }, (): KeyStep => ["tab", 0.05])];
}

/** Keys Auto-Tab presses after pasting `kind` to reach the field for `nextKind`. */
export function autotabSteps(kind: string, nextKind: string | null): KeyStep[] {
  if ((kind === "artist" || kind === "copyright_notice") && nextKind === "cover_art") return tabs(6);
  if (
    ((kind === "artist" || kind === "copyright_notice") && nextKind === "youtube_url") ||
    (kind === "youtube_url" && nextKind === "cover_art")
  ) {
    return tabs(3);
  }
  if (kind === "written_by" && (nextKind === "role" || nextKind === "copyright_role")) {
    // Skip the empty Produced By field, then open "Add additional credits".
    return [
      ["tab", 0.15],
      ["tab", 0.1],
      ["enter", 0.1],
    ];
  }
  if (kind === "written_by" && nextKind === "produced_by") return [["tab", 0.15]];
  if (
    ((kind === "produced_by" || kind === "artist") && (nextKind === "role" || nextKind === "copyright_role")) ||
    ((kind === "phonographic_copyright" || kind === "copyright_notice") && nextKind === "copyright_role")
  ) {
    return [
      ["tab", 0.15],
      ["enter", 0.1],
    ];
  }
  return [];
}

/** Instruction shown before the user presses the hotkey for queue[pos]. */
export function instructionText(queue: readonly QueueItem[], pos: number, hotkey: string): string {
  const item = queue[pos];
  if (!item) return "All done. Save the page on Genius.";
  const [kind] = item;
  const hk = hotkey.toUpperCase();
  const prev = pos > 0 ? queue[pos - 1]?.[0] : undefined;

  switch (kind) {
    case "written_by":
      return prev !== "written_by"
        ? `Click the Written By field, then press ${hk}`
        : `Field is ready. Press ${hk} to add the next songwriter`;
    case "produced_by":
      return prev !== "produced_by"
        ? `Click the Produced By field, then press ${hk}`
        : `Field is ready. Press ${hk} to add the next producer`;
    case "role":
    case "copyright_role":
      return `1. Click Add additional credits\n2. Click inside the Additional role field\n3. Press ${hk}`;
    case "phonographic_copyright":
    case "copyright_notice":
      return prev === "copyright_role"
        ? `Field is ready. Press ${hk} to add the label`
        : `Field is ready. Press ${hk} to add the next label`;
    case "cover_art":
      return `Press ${hk} to copy the 1000×1000 PNG cover art URL to clipboard`;
    case "youtube_url":
      return `Press ${hk} to copy the YouTube video URL to clipboard`;
    case "release_month":
      // The dropdowns sit in the Tags and Albums section, which may be collapsed. No Tab sequence leads there.
      return `Open the Tags and Albums section if it is closed. Click the Release Date Month dropdown, then press ${hk} to enter the month`;
    case "release_day":
      return `Click the Release Date Day dropdown, then press ${hk} to enter the day`;
    case "release_year":
      return `Click the Release Date Year dropdown, then press ${hk} to enter the year`;
    case "artist":
      return prev === "role"
        ? `Tab to Artists in this role, then press ${hk}`
        : `Field is ready. Press ${hk} to add the next artist`;
  }
}
