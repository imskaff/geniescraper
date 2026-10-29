import { describe, expect, it } from "vitest";
import { mergedCredits, typedQueue, type QueueOptions } from "../../src/core/models";
import vectors from "../vectors.json";
import { songFromVector, type SongName } from "./helpers";

function toOptions(flags: (typeof vectors.typed_queue)[number]["flags"]): QueueOptions {
  return {
    includeCore: flags.include_core,
    includeAdditional: flags.include_additional,
    includeCopyright: flags.include_copyright,
    includeYoutube: flags.include_youtube,
    includeCoverArt: flags.include_cover_art,
    includeReleaseDate: flags.include_release_date,
  };
}

describe("typedQueue parity with SongCredits.typed_queue", () => {
  const cases = vectors.typed_queue.map((c, i) => ({ ...c, label: `${c.song} #${String(i % 64)}` }));

  it.each(cases)("$label", ({ song, flags, queue }) => {
    expect(typedQueue(songFromVector(song as SongName), toOptions(flags))).toEqual(queue);
  });

  it("includes everything when no options are given", () => {
    const full = songFromVector("full");
    const everything = vectors.typed_queue.find(
      (c) => c.song === "full" && Object.values(c.flags).every(Boolean),
    )?.queue;
    expect(typedQueue(full)).toEqual(everything);
  });
});

describe("mergedCredits", () => {
  it("merges roles case-insensitively, keeps first casing and position, dedupes artists", () => {
    const merged = mergedCredits([
      { role: "Producer", artists: ["A", "B"] },
      { role: "Mixing Engineer", artists: ["C"] },
      { role: "producer", artists: ["B", "D"] },
    ]);
    expect(merged).toEqual([
      { role: "Producer", artists: ["A", "B", "D"] },
      { role: "Mixing Engineer", artists: ["C"] },
    ]);
  });

  it("drops roles without artists", () => {
    expect(mergedCredits([{ role: "Drums", artists: [] }])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [
      { role: "Drums", artists: ["A"] },
      { role: "drums", artists: ["B"] },
    ];
    mergedCredits(input);
    expect(input[0]?.artists).toEqual(["A"]);
  });
});
