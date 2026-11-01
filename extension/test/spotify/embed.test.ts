import { describe, expect, it } from "vitest";
import { releaseDateFromEmbed } from "../../src/spotify/embed";

const page = (json: string): string => `<script id="__NEXT_DATA__" type="application/json">${json}</script>`;
const entity = (releaseDate: unknown): string =>
  page(JSON.stringify({ props: { pageProps: { state: { data: { entity: { releaseDate } } } } } }));

describe("releaseDateFromEmbed", () => {
  it("returns the day of a full date", () => {
    expect(releaseDateFromEmbed(entity({ isoString: "1971-09-09T00:00:00Z" }))).toBe("1971-09-09");
  });

  it.each([
    ["a year-only release stored as 1 January", entity({ isoString: "2004-01-01T00:00:00Z" })],
    ["a missing date", entity(null)],
    ["a non-string date", entity({ isoString: 5 })],
    ["broken JSON", page("{nope")],
    ["no data script", "<html></html>"],
  ])("returns empty for %s", (_name, markup) => {
    expect(releaseDateFromEmbed(markup)).toBe("");
  });
});
