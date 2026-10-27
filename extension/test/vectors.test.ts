import { describe, expect, it } from "vitest";
import vectors from "./vectors.json";

// Slice 2 onwards consumes these sections; this guards the file itself so a bad export fails loudly.
describe("vectors.json", () => {
  const SECTIONS = [
    "songs",
    "typed_queue",
    "extract_labels",
    "split_copyright",
    "track_count_from_footer",
    "autotab_steps",
    "instruction_text",
    "normalise_cover_url",
    "pick_cover_url",
    "catalog_id",
    "catalog_ref",
    "normalise_role",
    "credits_from_cards",
    "credits_from_text",
    "words",
    "core_title_words",
  ];

  it.each(SECTIONS)("has a non-empty %s section", (section) => {
    const value = (vectors as Record<string, unknown>)[section];
    expect(value).toBeDefined();
    expect(Object.keys(value as object).length).toBeGreaterThan(0);
  });

  it("covers all 32 toggle combinations for every sample song", () => {
    const songs = Object.keys(vectors.songs);
    expect(vectors.typed_queue).toHaveLength(songs.length * 32);
  });
});
