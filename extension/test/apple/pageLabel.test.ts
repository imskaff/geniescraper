import { beforeEach, describe, expect, it } from "vitest";
import { readApplePageLabel } from "../../src/apple/pageLabel";
import type { OpenTab } from "../../src/core/musicTabs";
import { withPageTitles } from "../../src/ui/pageTitles";

const HEADER =
  '<div data-testid="container-detail-header"><h1 data-testid="non-editable-product-title">Lonely At The Top</h1>' +
  '<a href="https://music.apple.com/us/artist/joey-bada/1">Joey Bada$$</a><a href="https://music.apple.com/us/artist/other/2">Guest</a></div>';

beforeEach(() => {
  document.body.replaceChildren(...new DOMParser().parseFromString(HEADER, "text/html").body.childNodes);
});

describe("readApplePageLabel", () => {
  it("reads the album's own title and first artist from its header", () => {
    const label = readApplePageLabel();
    expect(label.title).toBe("Lonely At The Top");
    expect(label.artists).toEqual(["Joey Bada$$"]);
  });

  it("gives nothing for a page with no header", () => {
    document.body.replaceChildren();
    expect(readApplePageLabel().title).toBe("");
  });
});

describe("which Apple Music tabs are read from the page", () => {
  const tab = (url: string): OpenTab => ({ tabId: 1, url, title: "x", current: true });
  const reader = (calls: string[]) => (_id: number) => {
    calls.push("read");
    return Promise.resolve({
      path: "/us/album/lonely-at-the-top/1835726721",
      title: "Lonely At The Top",
      artists: ["Joey Bada$$"],
    });
  };

  it("reads an album address with a song picked, and keeps the header's name", async () => {
    const calls: string[] = [];
    const out = await withPageTitles(
      [tab("https://music.apple.com/us/album/lonely-at-the-top/1835726721?i=1835726995")],
      reader(calls),
    );
    expect(calls).toEqual(["read"]);
    expect([out[0]?.pageTitle, out[0]?.pageArtist]).toEqual(["Lonely At The Top", "Joey Bada$$"]);
  });

  it("does not read a plain album or a song page", async () => {
    const calls: string[] = [];
    await withPageTitles(
      [
        tab("https://music.apple.com/us/album/lonely-at-the-top/1835726721"),
        tab("https://music.apple.com/us/song/lunch/1739659140"),
      ],
      reader(calls),
    );
    expect(calls).toEqual([]);
  });
});
