import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { spotifyReader, spotifyUrl } from "../../scripts/lib/spotify-read.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(here, name), "utf-8").trim();
const reader = spotifyReader();
const nodesOf = (markup: string): Node[] => [...new DOMParser().parseFromString(markup, "text/html").body.childNodes];
const setBody = (markup: string): void => {
  document.body.replaceChildren(...nodesOf(markup));
};
const BARE = "button:not([aria-disabled]):not([aria-expanded])";

function dialogOf(name: string): Element {
  setBody(fixture(name));
  const dialog = reader.findDialog(document);
  if (!dialog) throw new Error(`${name} has no dialog`);
  return dialog;
}

beforeEach(() => {
  setBody("");
});

describe("parseDialog on saved dialogs", () => {
  it("reads the sections, rows, roles and source of a credit-heavy track", () => {
    const parsed = reader.parseDialog(dialogOf("credits-many-roles.html"));
    expect(parsed.heading).toBe("Credits");
    expect(parsed.title).toBe("Sample Song");
    expect(parsed.sections).toEqual([
      "Artist",
      "Composition & Lyrics",
      "Production & Engineering",
      "Performers",
      "Other Roles",
    ]);
    expect(parsed.rows.length).toBeGreaterThan(20);
    expect(parsed.source).toBe("Sample Label");
    expect(parsed.rows.every((r) => r.name.startsWith("Person ") || r.artistId !== null)).toBe(true);
  });

  it("marks artist rows by their artist id and keeps them in section 0", () => {
    const parsed = reader.parseDialog(dialogOf("credits-many-roles.html"));
    const artists = parsed.rows.filter((r) => r.artistId !== null);
    expect(artists.length).toBeGreaterThan(0);
    expect(artists.every((r) => r.sectionIndex === 0)).toBe(true);
    expect(parsed.rows.filter((r) => r.sectionIndex === 0).every((r) => r.artistId !== null)).toBe(true);
  });

  it("splits several roles of one person joined with a bullet", () => {
    const parsed = reader.parseDialog(dialogOf("credits-many-roles.html"));
    expect(parsed.rows.filter((r) => r.roles.length > 1).length).toBeGreaterThan(0);
  });

  it("reads an artist-only dialog as having no credit rows beyond the artists", () => {
    const parsed = reader.parseDialog(dialogOf("credits-artist-only.html"));
    expect(parsed.sections).toEqual(["Artist"]);
    expect(parsed.rows.every((r) => r.artistId !== null)).toBe(true);
    expect(parsed.source).toBe("Sample Label");
  });

  it("parses the German dialog with the same structure and keeps localized text as written", () => {
    const parsed = reader.parseDialog(dialogOf("credits-de.html"));
    expect(parsed.heading).toBe("Songinfos");
    expect(parsed.sections[0]).toBe("Künstler*in");
    expect(parsed.rows.find((r) => r.sectionIndex === 0)?.artistId).not.toBeNull();
    expect(parsed.rows.some((r) => r.roles.includes("Komponist*in"))).toBe(true);
    expect(parsed.source).toBe("Sample Label");
  });

  it("reads the older hand-trimmed fixtures too", () => {
    for (const name of ["credits-major.html", "credits-self-released.html"]) {
      const parsed = reader.parseDialog(dialogOf(name));
      expect(parsed.rows.length).toBeGreaterThan(2);
      expect(parsed.source).not.toBe("");
    }
  });
});

describe("findCreditsItem", () => {
  const cases: [string, number][] = [
    ["menu-track.html", 5],
    ["menu-track-de.html", 5],
    ["menu-album-row.html", 4],
  ];
  it.each(cases)("finds the credits entry in %s by structure, not by text", (name, index) => {
    setBody(fixture(name));
    const items = [...document.querySelectorAll("[role='menuitem']")];
    const found = reader.findCreditsItem(document);
    expect(found?.how).toBe("bare-button-before-share");
    expect(items.indexOf(found?.el as Element)).toBe(index);
  });

  it("falls back to a text match when the structure differs", () => {
    setBody('<ul role="menu"><li><button role="menuitem" aria-disabled="false">Share</button></li><li><a role="menuitem" href="/x">View credits</a></li></ul>');
    expect(reader.findCreditsItem(document)?.how).toBe("text");
  });

  it("returns null for a menu with nothing like credits", () => {
    setBody('<ul role="menu"><li><button role="menuitem" aria-disabled="false">Share</button></li></ul>');
    expect(reader.findCreditsItem(document)).toBeNull();
  });
});

describe("album page", () => {
  it("reads the track list, ids, numbers and the printed track count", () => {
    setBody(fixture("album-page.html"));
    const rows = reader.trackRows(document);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(rows[0]?.id).toMatch(/^SampleTrackId/);
    expect(rows[0]?.explicit).toBe(true);
    expect(rows[1]?.explicit).toBe(false);
    expect(rows.every((r) => r.more !== null)).toBe(true);
    expect(reader.readAlbumTrackCount(document)).toBe(3);
  });

  it("takes the copyright lines from main and ignores the footer", () => {
    setBody(fixture("album-page.html"));
    expect(reader.readCopyright(document)).toEqual({
      copyright: "© 2020 Sample Records",
      phonographic: "℗ 2020 Sample Records",
    });
  });
});

describe("readCredits end to end on a fake page", () => {
  /** A page whose options button opens the menu fixture, whose credits entry opens the dialog fixture. */
  function fakePage({ credits = true, failFirstClick = false } = {}): void {
    setBody('<main><div data-testid="action-bar-row"><button data-testid="more-button"></button></div></main>');
    const more = document.querySelector("button[data-testid='more-button']");
    if (!more) throw new Error("no button");
    let opened = 0;
    more.addEventListener("click", () => {
      const open = document.querySelector("[role='menu']");
      if (open) {
        open.remove();
        return;
      }
      opened++;
      const holder = document.createElement("div");
      holder.append(...nodesOf(fixture("menu-track.html")));
      if (!credits) holder.querySelector(BARE)?.remove(); // leaves "Open in Desktop app", which must not be taken
      document.body.append(holder);
      holder.querySelector(BARE)?.addEventListener("click", () => {
        if (failFirstClick && opened === 1) return;
        document.body.append(...nodesOf(fixture("credits-many-roles.html")));
      });
    });
  }

  it("opens the menu and the dialog and returns the parsed credits", async () => {
    fakePage();
    const result = await reader.readCredits(document, { timeoutMs: 500 });
    expect(result.status).toBe("ok");
    expect(result.attempt).toBe(1);
    expect(result.rows?.length).toBeGreaterThan(5);
  });

  it("says no-button when the page never shows an options button", async () => {
    setBody("<main></main>");
    expect((await reader.readCredits(document, { timeoutMs: 200 })).status).toBe("no-button");
  });

  it("says no-item when the menu has no credits entry", async () => {
    fakePage({ credits: false });
    const result = await reader.readCredits(document, { timeoutMs: 500, attempts: 1, menuMs: 300 });
    expect(result.status).toBe("no-item");
    expect(result.menu?.length).toBeGreaterThan(3);
  });

  it("retries once when the first click on the entry opened nothing", async () => {
    fakePage({ failFirstClick: true });
    const result = await reader.readCredits(document, { timeoutMs: 500, dialogMs: 300 });
    expect(result.status).toBe("ok");
    expect(result.attempt).toBe(2);
  });
});

describe("sanitizeDialog", () => {
  it("replaces names, the track and the source, including inside ids", () => {
    setBody('<dialog open aria-label="Credits"><h1>Credits</h1><h2>Real Song</h2><div><span>Writers</span><div role="group" aria-labelledby="listrow-title-Jane Doe"><span dir="auto">Jane Doe</span><p id="listrow-subtitle-Jane Doe"><span>Composer</span></p></div></div><div role="group" aria-labelledby="listrow-title-sources"><span>Sources</span><span>Real Label</span></div></dialog>');
    const dialog = reader.findDialog(document);
    if (!dialog) throw new Error("no dialog");
    const html = reader.sanitizeDialog(dialog);
    expect(html).not.toMatch(/Jane|Doe|Real/);
    expect(html).toContain("Person 1");
    expect(html).toContain("Sample Song");
    expect(html).toContain("Sample Label");
    expect(html).toContain("Composer");
  });
});

describe("spotifyUrl", () => {
  it("builds plain and intl urls", () => {
    expect(spotifyUrl("track", "abc", { intl: "" })).toBe("https://open.spotify.com/track/abc");
    expect(spotifyUrl("album", "abc")).toBe("https://open.spotify.com/intl-en/album/abc");
  });
});
