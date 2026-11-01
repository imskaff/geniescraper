import { describe, expect, it } from "vitest";
import { deriveLabelInfo } from "../../src/core/labels";
import { extractLabels, splitCopyright, trackCountFromFooter } from "../../src/core/copyright";
import vectors from "../vectors.json";

describe("extractLabels parity with scraper.models._extract_labels", () => {
  it.each(vectors.extract_labels)("$input", ({ input, output }) => {
    expect(extractLabels(input)).toEqual(output);
  });
});

describe("splitCopyright parity with scraper.apple_music.split_copyright", () => {
  it.each(vectors.split_copyright)("$input", ({ input, output }) => {
    expect(splitCopyright(input)).toEqual(output);
  });
});

describe("trackCountFromFooter parity with scraper.apple_music.track_count_from_footer", () => {
  it.each(vectors.track_count_from_footer)("$input", ({ input, output }) => {
    expect(trackCountFromFooter(input)).toBe(output);
  });
});

describe("deriveLabelInfo parity with scraper.labels.derive_label_info", () => {
  it.each(vectors.label_info)("$input", ({ input, output }) => {
    const info = deriveLabelInfo(input, extractLabels(input));
    expect({
      label: info.label,
      distributor: info.distributor,
      label_source: info.labelSource,
      distributor_source: info.distributorSource,
    }).toEqual(output);
  });
});
