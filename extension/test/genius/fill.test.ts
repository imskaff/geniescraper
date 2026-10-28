import { describe, expect, it } from "vitest";
import { typedQueue, type QueueItem } from "../../src/core/models";
import { clearTyped, fillStep, type FillContext, type StepOutcome } from "../../src/genius/fill";
import { songFromVector } from "../parity/helpers";
import { chipsIn, loadFakeGenius, rowChips, type FakeGenius, type FakeOptions } from "./fakeGenius";
import { addCreditsButton } from "../../src/genius/selectors";

const TIMING = { suggestionMs: 400, settleMs: 60, selectMs: 300, pollMs: 5 };

function setup(options: FakeOptions = {}, autoConfirm = true) {
  const fake = loadFakeGenius(options);
  const ctx: FillContext = { doc: fake.doc, timing: TIMING, autoConfirm };
  const run = (item: QueueItem): Promise<StepOutcome> => fillStep(item, ctx);
  return { fake, ctx, run };
}

const writerBox = (fake: FakeGenius): Element | null =>
  [...fake.form.querySelectorAll("label")]
    .find((l) => l.querySelector("span")?.textContent.startsWith("Writer"))
    ?.querySelector('[role="combobox"]') ?? null;
const producerBox = (fake: FakeGenius): Element | null =>
  [...fake.form.querySelectorAll("label")]
    .find((l) => l.querySelector("span")?.textContent.startsWith("Producer"))
    ?.querySelector('[role="combobox"]') ?? null;

/** What must never happen, on every run. */
function expectSafe(fake: FakeGenius): void {
  expect(fake.saveClicks, "Save was clicked").toBe(0);
  expect(fake.cancelClicks, "Cancel was clicked").toBe(0);
  expect(fake.submits, "the form was submitted").toBe(0);
  expect(fake.strayEnters, "Enter reached a plain input").toEqual([]);
  expect(
    fake.enters.filter((e) => !e.open),
    "Enter reached a combobox with no open menu",
  ).toEqual([]);
}

describe("combobox fields (Writer, Producer)", () => {
  it("chooses the exact match and reports it", async () => {
    const { fake, run } = setup();
    const outcome = await run(["written_by", "Billie Eilish"]);
    expect(outcome).toEqual({ status: "filled", message: "Added Billie Eilish." });
    expect(chipsIn(writerBox(fake))).toEqual(["Billie Eilish"]);
    expect(fake.chosen).toEqual(["Writer: Billie Eilish"]);
    expectSafe(fake);
  });

  it("puts a producer in the Producer field, not the Writer field", async () => {
    const { fake, run } = setup();
    await run(["produced_by", "FINNEAS"]);
    expect(chipsIn(producerBox(fake))).toEqual(["FINNEAS"]);
    expect(chipsIn(writerBox(fake))).toEqual([]);
  });

  it("chooses the exact match even when it is not the first suggestion", async () => {
    const { fake, run } = setup({ artists: ["Billie Eilish, FINNEAS, Tim Anderson, Aron Forbes", "Billie Eilish"] });
    expect(await run(["written_by", "Billie Eilish"])).toMatchObject({ status: "filled" });
    expect(chipsIn(writerBox(fake))).toEqual(["Billie Eilish"]);
    expectSafe(fake);
  });

  it("matches ignoring case and accents", async () => {
    const { fake, run } = setup({ artists: ["Beyoncé", "Beyonce Giselle"] });
    expect(await run(["written_by", "BEYONCE"])).toMatchObject({ status: "filled" });
    expect(chipsIn(writerBox(fake))).toEqual(["Beyoncé"]);
  });

  it("never picks a different entity that merely contains the name", async () => {
    const { fake, run } = setup({
      artists: ["Billie Eilish, FINNEAS, Tim Anderson, Aron Forbes", "Balarke a.k.a Billie Eilish from BTS"],
    });
    const outcome = await run(["written_by", "Billie Eilish"]);
    expect(outcome.status).toBe("needs-choice");
    expect(chipsIn(writerBox(fake))).toEqual([]);
    expectSafe(fake);
  });

  it("leaves a made-up name for the user instead of taking the fuzzy first suggestion", async () => {
    const { fake, run } = setup();
    const outcome = await run(["written_by", "zzqxv nobody 99"]);
    expect(outcome).toMatchObject({ status: "needs-choice" });
    expect(outcome.message).toContain("no exact match");
    // Genius did offer "99 Neighbors" first, and a Create option last; neither was chosen.
    expect(chipsIn(writerBox(fake))).toEqual([]);
    expect(fake.chosen).toEqual([]);
    expect(fake.enters).toEqual([]);
    const input = writerBox(fake)?.querySelector("input");
    expect(input?.value).toBe("zzqxv nobody 99");
    expect(input?.getAttribute("aria-expanded")).toBe("true");
  });

  it("says so when Genius has nothing at all", async () => {
    const { fake, run } = setup({ artists: ["Taylor Swift"] });
    const outcome = await run(["written_by", "Qqqq"]);
    expect(outcome.status).toBe("needs-choice");
    expect(outcome.message).toContain("nothing");
    expectSafe(fake);
  });

  it("is idempotent: a value already chosen is not typed again", async () => {
    const { fake, run } = setup();
    await run(["written_by", "Billie Eilish"]);
    const again = await run(["written_by", "Billie Eilish"]);
    expect(again).toEqual({ status: "filled", message: "Billie Eilish was already there." });
    expect(fake.chosen).toEqual(["Writer: Billie Eilish"]);
  });

  it("adds a second writer next to the first", async () => {
    const { fake, run } = setup();
    await run(["written_by", "Billie Eilish"]);
    await run(["written_by", "FINNEAS"]);
    expect(chipsIn(writerBox(fake))).toEqual(["FINNEAS", "Billie Eilish"]);
  });

  it("only types and waits when auto-confirm is off", async () => {
    const { fake, run } = setup({}, false);
    const outcome = await run(["written_by", "Billie Eilish"]);
    expect(outcome).toMatchObject({ status: "needs-choice" });
    expect(chipsIn(writerBox(fake))).toEqual([]);
    expect(fake.enters).toEqual([]);
    expect(writerBox(fake)?.querySelector("input")?.value).toBe("Billie Eilish");
  });

  it("waits for suggestions that arrive in two batches before trusting the list", async () => {
    const { fake, run } = setup({ suggestionDelayMs: 10, secondBatchAfterMs: 30 });
    expect(await run(["written_by", "Billie Eilish"])).toMatchObject({ status: "filled" });
    expect(chipsIn(writerBox(fake))).toEqual(["Billie Eilish"]);
    expectSafe(fake);
  });
});

describe("additional credits behind an Expand button", () => {
  // A song that already has additional roles shows "2 additional roles" and Expand; the rows and the Add button are
  // not in the page until it is pressed. Found by running the extension on a real song.
  it("opens them for the first role, then fills it like any other", async () => {
    const { fake, run } = setup({ collapsedRoles: true });
    expect(fake.form.querySelector("[data-testid='custom-performances-expander']")).not.toBeNull();
    expect(await run(["role", "Mixing Engineer"])).toMatchObject({ status: "filled" });
    expect(fake.expands).toBe(1);
    expect(rowChips(fake.form)[0]).toEqual({ role: ["Mixing Engineer"], artists: [] });
    expect(await run(["artist", "FINNEAS"])).toMatchObject({ status: "filled" });
    expect(rowChips(fake.form)).toEqual([{ role: ["Mixing Engineer"], artists: ["FINNEAS"] }]);
    expectSafe(fake);
  });

  it("never presses the button of a section that is already open, where it reads Hide", async () => {
    const { fake, run } = setup();
    expect(fake.form.querySelector("[data-testid='custom-performances-expander']")?.textContent.trim()).toBe("Hide");
    await run(["role", "Mixing Engineer"]);
    await run(["artist", "FINNEAS"]);
    expect(fake.expands).toBe(0);
    expect(rowChips(fake.form)).toEqual([{ role: ["Mixing Engineer"], artists: ["FINNEAS"] }]);
  });

  it("opens them only once, however many roles follow", async () => {
    const { fake, run } = setup({ collapsedRoles: true });
    await run(["role", "Mixing Engineer"]);
    await run(["artist", "FINNEAS"]);
    await run(["role", "Vocals"]);
    expect(fake.expands).toBe(1);
  });

  it("opens them for an artist step when the role step was skipped and nothing is open yet", async () => {
    const { fake, run } = setup({ collapsedRoles: true });
    const outcome = await run(["artist", "FINNEAS"]);
    // Opened, but there is no role to put the artist under: it still says so rather than guessing a row.
    expect(fake.expands).toBe(1);
    expect(outcome).toMatchObject({ status: "unavailable" });
    expect(outcome.message).toMatch(/role/);
  });

  it("says plainly when the section will not open", async () => {
    const { fake, run } = setup({ collapsedRoles: true });
    fake.form.querySelector("[data-testid='custom-performances-expander']")?.remove();
    expect(await run(["role", "Mixing Engineer"])).toMatchObject({ status: "unavailable" });
  });
});

describe("additional credits", () => {
  it("uses the existing empty row for the first role, then puts artists in that row", async () => {
    const { fake, run } = setup();
    expect(rowChips(fake.form)).toHaveLength(1);
    expect(await run(["role", "Mixing Engineer"])).toMatchObject({ status: "filled" });
    expect(await run(["artist", "FINNEAS"])).toMatchObject({ status: "filled" });
    expect(await run(["artist", "Billie Eilish"])).toMatchObject({ status: "filled" });
    expect(rowChips(fake.form)).toEqual([{ role: ["Mixing Engineer"], artists: ["Billie Eilish", "FINNEAS"] }]);
    expectSafe(fake);
  });

  it("adds a new row only when the last row's role is already filled", async () => {
    const { fake, run } = setup();
    await run(["role", "Mixing Engineer"]);
    await run(["artist", "FINNEAS"]);
    await run(["role", "Mastering Engineer"]);
    expect(rowChips(fake.form)).toHaveLength(2);
    await run(["artist", "Taylor Swift"]);
    expect(rowChips(fake.form)).toEqual([
      { role: ["Mixing Engineer"], artists: ["FINNEAS"] },
      { role: ["Mastering Engineer"], artists: ["Taylor Swift"] },
    ]);
    expectSafe(fake);
  });

  it("does not add a row for a role when the last one is still empty", async () => {
    const { fake, run } = setup();
    await run(["role", "Mixing Engineer"]);
    expect(rowChips(fake.form)).toHaveLength(1);
  });

  it("creates the first row when the form has none", async () => {
    const { fake, run } = setup({ noRows: true });
    expect(rowChips(fake.form)).toHaveLength(0);
    expect(await run(["role", "Lead Vocals"])).toMatchObject({ status: "filled" });
    expect(rowChips(fake.form)).toEqual([{ role: ["Lead Vocals"], artists: [] }]);
  });

  it("matches the copyright roles despite the symbols Genius adds to their names", async () => {
    const { fake, run } = setup();
    expect(await run(["copyright_role", "Phonographic Copyright"])).toMatchObject({ status: "filled" });
    await run(["phonographic_copyright", "Taylor Swift"]);
    expect(await run(["copyright_role", "Copyright"])).toMatchObject({ status: "filled" });
    await run(["copyright_notice", "FINNEAS"]);
    expect(rowChips(fake.form)).toEqual([
      { role: ["Phonographic Copyright ℗"], artists: ["Taylor Swift"] },
      { role: ["Copyright ©"], artists: ["FINNEAS"] },
    ]);
    expectSafe(fake);
  });

  it("leaves a role Genius does not have for the user, and keeps the row for them", async () => {
    const { fake, run } = setup();
    const outcome = await run(["role", "Programming"]);
    expect(outcome.status).toBe("needs-choice");
    expect(rowChips(fake.form)).toEqual([{ role: [], artists: [] }]);
    expect(fake.chosen).toEqual([]);
    expectSafe(fake);
  });

  it("never files an artist under a role that was skipped: the next role gets only its own artists", async () => {
    // Queue: role Programming (Genius has none), artist FINNEAS, role Lead Vocals, artist Billie Eilish.
    const { fake, run } = setup();
    expect((await run(["role", "Programming"])).status).toBe("needs-choice");
    // The user skipped the role, but the artist step still comes up.
    const orphan = await run(["artist", "FINNEAS"]);
    expect(orphan.status).toBe("unavailable");
    expect(orphan.message).toContain("role");
    expect(rowChips(fake.form).flatMap((row) => row.artists)).toEqual([]);

    await run(["role", "Lead Vocals"]);
    await run(["artist", "Billie Eilish"]);
    expect(rowChips(fake.form)).toEqual([{ role: ["Lead Vocals"], artists: ["Billie Eilish"] }]);
    expectSafe(fake);
  });

  it.each(["artist", "phonographic_copyright", "copyright_notice"] as const)(
    "refuses a %s step while the row's role is empty",
    async (kind) => {
      const { fake, run } = setup();
      const outcome = await run([kind, "FINNEAS"]);
      expect(outcome.status).toBe("unavailable");
      expect(fake.chosen).toEqual([]);
      expect(fake.enters).toEqual([]);
    },
  );

  it("will not put an artist anywhere when there is no role row yet", async () => {
    const { fake, run } = setup({ noRows: true });
    expect(await run(["artist", "FINNEAS"])).toMatchObject({ status: "unavailable" });
    expect(fake.chosen).toEqual([]);
  });

  it("says so when the form has no Add additional credits button and no row", async () => {
    const { run } = setup({ noRows: true, noAddButton: true });
    const outcome = await run(["role", "Lead Vocals"]);
    expect(outcome.status).toBe("unavailable");
    expect(outcome.message).toContain("Add additional credits");
  });
});

describe("plain inputs", () => {
  it.each([
    ["youtube_url", "https://www.youtube.com/watch?v=abc123", "youtube_url"],
    ["cover_art", "https://example.com/cover.png", "custom_song_art_image_url"],
  ] as const)("sets %s with input and change events and no key presses", async (kind, value, name) => {
    const { fake, run } = setup();
    expect(await run([kind, value])).toMatchObject({ status: "filled" });
    expect(fake.form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value).toBe(value);
    expect(fake.plainEvents).toEqual([`${name}:input`, `${name}:change`]);
    expect(fake.plainKeys).toEqual([]);
    expectSafe(fake);
  });
});

describe("without the form", () => {
  it.each([
    { item: ["written_by", "A"] as QueueItem },
    { item: ["role", "Mixing Engineer"] as QueueItem },
    { item: ["youtube_url", "https://x"] as QueueItem },
  ])("reports that the Edit Metadata form is not open for $item", async ({ item }) => {
    const { fake, run } = setup();
    fake.form.remove();
    const outcome = await run(item);
    expect(outcome).toMatchObject({ status: "unavailable" });
    expect(outcome.message).toContain("Edit Metadata");
  });
});

describe("a whole song", () => {
  it("fills every step of a real queue and touches nothing it must not", async () => {
    const song = {
      ...songFromVector("full"),
      youtubeUrl: "https://www.youtube.com/watch?v=abc",
      coverArtUrl: "https://example.com/c.png",
    };
    const queue = typedQueue(song);
    const { fake, run } = setup({
      artists: ["W1", "W2", "W3", "P1", "P2", "P3", "M1", "M2", "V1", "V2", "Top Dawg Entertainment", "RCA Records"],
      roles: ["Mixing Engineer", "Background Vocals", "Phonographic Copyright ℗", "Copyright ©"],
    });

    const outcomes: string[] = [];
    for (const item of queue) outcomes.push(`${item[0]}:${(await run(item)).status}`);

    expect(outcomes.filter((o) => !o.endsWith(":filled"))).toEqual([]);
    expect(chipsIn(writerBox(fake)).sort()).toEqual(["W1", "W2", "W3"]);
    expect(chipsIn(producerBox(fake)).sort()).toEqual(["P1", "P2", "P3"]);
    expect(rowChips(fake.form).map((r) => [r.role[0], [...r.artists].sort()])).toEqual([
      ["Mixing Engineer", ["M1", "M2"]],
      ["Background Vocals", ["V1", "V2"]],
      ["Phonographic Copyright ℗", ["RCA Records", "Top Dawg Entertainment"]],
      ["Copyright ©", ["Top Dawg Entertainment"]],
    ]);
    expect(fake.form.querySelector<HTMLInputElement>('input[name="youtube_url"]')?.value).toBe(song.youtubeUrl);
    expect(fake.form.querySelector<HTMLInputElement>('input[name="custom_song_art_image_url"]')?.value).toBe(
      song.coverArtUrl,
    );
    expectSafe(fake);
  });
});

describe("roles the form already has", () => {
  async function formWithRoles() {
    const { fake, ctx, run } = setup();
    await run(["role", "Mixing Engineer"]);
    await run(["artist", "Billie Eilish"]);
    await run(["role", "Mastering Engineer"]);
    await run(["artist", "Taylor Swift"]);
    return { fake, ctx, run };
  }

  it("does not add a second row for a role that is already there", async () => {
    const { fake, run } = await formWithRoles();
    const outcome = await run(["role", "Mixing Engineer"]);
    expect(outcome).toEqual({ status: "filled", message: "Mixing Engineer was already there." });
    expect(rowChips(fake.form)).toHaveLength(2);
    expectSafe(fake);
  });

  it("recognises the role however Genius spells it, such as the symbol it adds to a copyright role", async () => {
    const { fake, run } = setup();
    await run(["copyright_role", "Phonographic Copyright"]);
    const rows = rowChips(fake.form).length;
    const outcome = await run(["copyright_role", "Phonographic Copyright"]);
    expect(outcome).toMatchObject({ status: "filled" });
    expect(outcome.message).toMatch(/already there/);
    expect(rowChips(fake.form)).toHaveLength(rows);
  });

  it("puts an artist under the row of its own role, not under the last row", async () => {
    const { fake, ctx } = await formWithRoles();
    const outcome = await fillStep(["artist", "FINNEAS"], { ...ctx, role: "Mixing Engineer" });
    expect(outcome).toMatchObject({ status: "filled" });
    expect(rowChips(fake.form).map((r) => ({ role: r.role, artists: [...r.artists].sort() }))).toEqual([
      { role: ["Mixing Engineer"], artists: ["Billie Eilish", "FINNEAS"] },
      { role: ["Mastering Engineer"], artists: ["Taylor Swift"] },
    ]);
  });

  it("leaves an artist alone that is already under that role", async () => {
    const { fake, ctx } = await formWithRoles();
    const outcome = await fillStep(["artist", "Billie Eilish"], { ...ctx, role: "Mixing Engineer" });
    expect(outcome.message).toMatch(/already there/);
    expect(rowChips(fake.form)[0]).toEqual({ role: ["Mixing Engineer"], artists: ["Billie Eilish"] });
  });

  it("still adds a row for a role the form does not have yet", async () => {
    const { fake, run } = await formWithRoles();
    await run(["role", "Lead Vocals"]);
    expect(rowChips(fake.form).map((r) => r.role)).toEqual([
      ["Mixing Engineer"],
      ["Mastering Engineer"],
      ["Lead Vocals"],
    ]);
  });

  it("reuses an empty row a skipped role left behind, wherever it is, instead of adding another", async () => {
    const { fake, ctx, run } = setup();
    // A role typed and skipped leaves its row empty; a later role fills the next row, so the empty one is not last.
    await fillStep(["role", "Mixing Engineer"], { ...ctx, autoConfirm: false });
    clearTyped(fake.doc, ["role", "Mixing Engineer"]);
    addCreditsButton(fake.form)?.click();
    await run(["role", "Lead Vocals"]);
    expect(rowChips(fake.form).map((r) => r.role)).toEqual([[], ["Lead Vocals"]]);

    await run(["role", "Mixing Engineer"]);
    expect(rowChips(fake.form).map((r) => r.role)).toEqual([["Mixing Engineer"], ["Lead Vocals"]]);
  });
});

describe("skipping a step leaves nothing of it in the field", () => {
  const inputOf = (box: Element | null): HTMLInputElement | null => box?.querySelector("input") ?? null;

  it("clears a name that was typed and not chosen, so it cannot become a new artist page", async () => {
    const { fake, run } = setup({}, false);
    await run(["written_by", "zzqxv nobody 99"]);
    expect(inputOf(writerBox(fake))?.value).toBe("zzqxv nobody 99");
    clearTyped(fake.doc, ["written_by", "zzqxv nobody 99"]);
    expect(inputOf(writerBox(fake))?.value).toBe("");
    expect(chipsIn(writerBox(fake))).toEqual([]);
    expectSafe(fake);
  });

  it("keeps what is already chosen in the field", async () => {
    const { fake, ctx } = setup();
    await fillStep(["written_by", "Billie Eilish"], ctx);
    await fillStep(["written_by", "zzqxv nobody 99"], { ...ctx, autoConfirm: false });
    clearTyped(fake.doc, ["written_by", "zzqxv nobody 99"]);
    expect(chipsIn(writerBox(fake))).toEqual(["Billie Eilish"]);
    expect(inputOf(writerBox(fake))?.value).toBe("");
  });

  it("clears the producer field, a role, and an artist under its own role", async () => {
    const { fake, ctx } = setup({}, false);
    await fillStep(["produced_by", "zzqxv nobody 99"], ctx);
    clearTyped(fake.doc, ["produced_by", "zzqxv nobody 99"]);
    expect(inputOf(producerBox(fake))?.value).toBe("");

    await fillStep(["role", "Mixing Engineer"], ctx);
    const roleInput = fake.form.querySelector<HTMLInputElement>("#custom_performances-0-label input");
    expect(roleInput?.value).not.toBe("");
    clearTyped(fake.doc, ["role", "Mixing Engineer"]);
    expect(roleInput?.value).toBe("");
  });

  it("leaves other fields alone, and does nothing when nothing was typed", async () => {
    const { fake, ctx } = setup();
    await fillStep(["youtube_url", "https://www.youtube.com/watch?v=abc"], ctx);
    clearTyped(fake.doc, ["youtube_url", "https://www.youtube.com/watch?v=abc"]);
    expect(fake.form.querySelector<HTMLInputElement>('input[name="youtube_url"]')?.value).toBe(
      "https://www.youtube.com/watch?v=abc",
    );
    expect(() => {
      clearTyped(fake.doc, ["artist", "Nobody"], "No Such Role");
    }).not.toThrow();
    expect(fake.chosen).toEqual([]);
  });
});
