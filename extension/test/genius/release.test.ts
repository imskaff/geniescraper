// The three Release Date dropdowns (Month, Day, Year) of Genius's edit form, filled from a fake built on the captured
// fixture tests/fixtures/genius-release-date.html. The real option texts are not known yet, so the fake spells them in
// every plausible style and the fill must cope with each, and never choose a wrong option silently.
import { describe, expect, it } from "vitest";
import type { QueueItem } from "../../src/core/models";
import {
  clearTyped,
  fillStep,
  isStepDone,
  releaseOptionMatches,
  stepSnapshot,
  type FillContext,
  type StepOutcome,
} from "../../src/genius/fill";
import { dropdownBox, releaseInput, singleValueText } from "../../src/genius/selectors";
import { loadFakeGenius, type FakeGenius, type FakeOptions } from "./fakeGenius";

const TIMING = { suggestionMs: 400, settleMs: 60, selectMs: 300, pollMs: 5 };

const MONTH: QueueItem = ["release_month", "May"];
const DAY: QueueItem = ["release_day", "5"];
const YEAR: QueueItem = ["release_year", "2024"];

function setup(options: FakeOptions = {}, autoConfirm = true) {
  const fake = loadFakeGenius(options);
  const ctx: FillContext = { doc: fake.doc, timing: TIMING, autoConfirm };
  const run = (item: QueueItem): Promise<StepOutcome> => fillStep(item, ctx);
  return { fake, ctx, run };
}

const input = (fake: FakeGenius, label: string): HTMLInputElement => {
  const found = releaseInput(fake.doc, label);
  if (!found) throw new Error(`no ${label} dropdown`);
  return found;
};
const shown = (fake: FakeGenius, label: string): string => singleValueText(dropdownBox(input(fake, label)));

function expectSafe(fake: FakeGenius): void {
  expect(fake.saveClicks + fake.cancelClicks + fake.submits).toBe(0);
  expect(fake.strayEnters).toEqual([]);
  expect(fake.enters.filter((e) => !e.open)).toEqual([]);
}

describe("the three dropdowns", () => {
  it("chooses the month, the day and the year, and reports each", async () => {
    const { fake, run } = setup();
    expect(await run(MONTH)).toEqual({ status: "filled", message: "Set the release month to May." });
    expect(await run(DAY)).toEqual({ status: "filled", message: "Set the release day to 5." });
    expect(await run(YEAR)).toEqual({ status: "filled", message: "Set the release year to 2024." });
    expect(fake.chosen).toEqual(["Release Month: May", "Release Day: 5", "Release Year: 2024"]);
    expect([shown(fake, "Release Month"), shown(fake, "Release Day"), shown(fake, "Release Year")]).toEqual([
      "May",
      "5",
      "2024",
    ]);
    expectSafe(fake);
  });

  it("takes the real, unchanged field labels from the fixture", () => {
    const { fake } = setup();
    expect(Object.keys(fake.releaseOptions)).toEqual(["Release Month", "Release Day", "Release Year"]);
  });

  it.each(["names", "short", "numbers", "padded", "both"] as const)(
    "copes with months spelled as %s",
    async (style) => {
      const { fake, run } = setup({ release: { months: style } });
      expect(await run(MONTH)).toMatchObject({ status: "filled" });
      expect(fake.chosen).toHaveLength(1);
      const chosen = fake.chosen[0]?.replace("Release Month: ", "") ?? "";
      expect(releaseOptionMatches("release_month", "May", chosen)).toBe(true);
      expectSafe(fake);
    },
  );

  it("finds a month by its number when typing its name finds nothing", async () => {
    // The list holds only numbers: typing "December" shows no options, so the number is tried.
    const { fake, run } = setup({ release: { months: "numbers" } });
    expect(await run(["release_month", "December"])).toMatchObject({ status: "filled" });
    expect(fake.chosen).toEqual(["Release Month: 12"]);
  });

  it("does not take 1 for 11 or 12 when the number is typed", async () => {
    const { fake, run } = setup({ release: { months: "numbers" } });
    await run(["release_month", "January"]);
    expect(fake.chosen).toEqual(["Release Month: 1"]);
  });

  it("chooses the 5th among 5, 15 and 25", async () => {
    const { fake, run } = setup();
    await run(DAY);
    expect(fake.chosen).toEqual(["Release Day: 5"]);
  });

  it("takes the zero-padded day for the same number", async () => {
    const { fake, run } = setup({ release: { paddedDays: true } });
    expect(await run(DAY)).toMatchObject({ status: "filled" });
    expect(fake.chosen).toEqual(["Release Day: 05"]);
    expect(await run(["release_day", "17"])).toMatchObject({ status: "filled" });
    expect(fake.chosen.at(-1)).toBe("Release Day: 17");
  });
});

describe("a value that is already there", () => {
  it("skips a dropdown that holds the value, whichever way it spells it", async () => {
    const { fake, run } = setup({ release: { preset: { "Release Month": "May - 5", "Release Day": "05" } } });
    expect(await run(MONTH)).toEqual({ status: "filled", message: "The release month was already May - 5." });
    expect(await run(DAY)).toEqual({ status: "filled", message: "The release day was already 05." });
    expect(fake.chosen).toEqual(["Release Month: May - 5", "Release Day: 05"]); // only the two presets
    expect(fake.enters).toEqual([]);
  });

  it("replaces a different value with the one wanted", async () => {
    const { fake, run } = setup({ release: { preset: { "Release Year": "2023" } } });
    expect(await run(YEAR)).toMatchObject({ status: "filled" });
    expect(shown(fake, "Release Year")).toBe("2024");
  });
});

describe("when the list has no exact option", () => {
  it("leaves the typing and the suggestions for the user and says so", async () => {
    const { fake, run } = setup({ release: { months: "odd" } });
    const outcome = await run(MONTH);
    expect(outcome).toEqual({
      status: "needs-choice",
      message: "Genius has no exact match for the release month May. Choose it yourself, or press Skip.",
    });
    expect(fake.chosen).toEqual([]);
    expect(input(fake, "Release Month").value).not.toBe("");
    expect(input(fake, "Release Month").getAttribute("aria-expanded")).toBe("true");
    expectSafe(fake);
  });

  it("does not pick another year just because it is near", async () => {
    const { fake, run } = setup({ release: { years: [2023, 2025] } });
    expect((await run(YEAR)).status).toBe("needs-choice");
    expect(fake.chosen).toEqual([]);
  });

  it("does not take 15 or 25 for the 5th when only those exist", async () => {
    const { fake, run } = setup({ release: { days: ["15", "25"] } });
    expect((await run(DAY)).status).toBe("needs-choice");
    expect(fake.chosen).toEqual([]);
    expect(input(fake, "Release Day").value).toBe("5");
  });

  it("types the value and chooses nothing when auto-confirm is off", async () => {
    const { fake, run } = setup({}, false);
    const outcome = await run(MONTH);
    expect(outcome.status).toBe("needs-choice");
    expect(outcome.message).toContain("Choose the release month from the list, then press Next");
    expect(fake.chosen).toEqual([]);
    expect(input(fake, "Release Month").value).toBe("May");
  });
});

describe("the Tags and Albums section", () => {
  it("opens it when it is closed, once, and says so", async () => {
    const { fake, run } = setup({ release: { collapsed: true } });
    const first = await run(MONTH);
    expect(first).toEqual({
      status: "filled",
      message: "Opened the Tags and Albums section. Set the release month to May.",
    });
    expect(await run(DAY)).toEqual({ status: "filled", message: "Set the release day to 5." });
    expect(fake.tagsToggles).toBe(1);
    expect(fake.chosen).toEqual(["Release Month: May", "Release Day: 5"]);
    expectSafe(fake);
  });

  it("opens it when its content is not in the page at all while it is closed", async () => {
    const { fake, run } = setup({ release: { collapsed: true, unmountedWhenCollapsed: true } });
    expect(fake.doc.querySelector('input[aria-label="Release Month"]')).toBeNull();
    expect(await run(MONTH)).toMatchObject({ status: "filled" });
    expect(fake.tagsToggles).toBe(1);
    expect(shown(fake, "Release Month")).toBe("May");
  });

  it("never presses the control of a section that is already open", async () => {
    const { fake, run } = setup();
    await run(MONTH);
    await run(YEAR);
    expect(fake.tagsToggles).toBe(0);
  });

  it("stops with a plain message when the section is closed and cannot be opened", async () => {
    const { fake, run } = setup({ release: { collapsed: true, noExpander: true } });
    expect(await run(MONTH)).toEqual({
      status: "unavailable",
      message: "Open the Tags and Albums section, then press Next.",
    });
    expect(fake.chosen).toEqual([]);
  });

  it("stops with the same message when the form has no Release Date at all", async () => {
    const { run } = setup({ release: { absent: true } });
    expect(await run(YEAR)).toMatchObject({
      status: "unavailable",
      message: "Open the Tags and Albums section, then press Next.",
    });
  });
});

describe("what a step holds, and when it is done", () => {
  it("reads the single value of a dropdown", async () => {
    const { fake, run, ctx } = setup({ release: { preset: { "Release Month": "April" } } });
    expect(stepSnapshot(fake.doc, MONTH)).toEqual(["April"]);
    expect(stepSnapshot(fake.doc, YEAR)).toEqual([]);
    expect(isStepDone(ctx.doc, MONTH, ["April"])).toBe(false); // still what it was
    await run(MONTH);
    expect(isStepDone(ctx.doc, MONTH, ["April"])).toBe(true);
  });

  it("counts the step done when the user picks another value where there was none", () => {
    const { fake, ctx } = setup({ release: { preset: { "Release Year": "2022" } } });
    expect(isStepDone(ctx.doc, YEAR, [])).toBe(true);
    expect(stepSnapshot(fake.doc, YEAR)).toEqual(["2022"]);
  });

  it("takes back typed text when the step is skipped, and leaves a chosen value alone", async () => {
    const { fake, ctx, run } = setup({ release: { months: "odd", preset: { "Release Year": "2022" } } }, true);
    await run(MONTH); // leaves text typed
    expect(input(fake, "Release Month").value).not.toBe("");
    clearTyped(ctx.doc, MONTH);
    expect(input(fake, "Release Month").value).toBe("");
    clearTyped(ctx.doc, YEAR);
    expect(shown(fake, "Release Year")).toBe("2022");
  });
});

describe("which option texts count as the value", () => {
  it.each([
    ["release_month", "May", "May", true],
    ["release_month", "May", "may", true],
    ["release_month", "May", "5", true],
    ["release_month", "May", "05", true],
    ["release_month", "May", "May - 5", true],
    ["release_month", "May", "5 May", true],
    ["release_month", "May", "May - 6", false],
    ["release_month", "May", "Mayo", false],
    ["release_month", "May", "15", false],
    ["release_month", "September", "Sep", true],
    ["release_month", "September", "Sept", true],
    ["release_month", "September", "9", true],
    ["release_month", "March", "Mar", true],
    ["release_month", "March", "Mai", false],
    ["release_day", "5", "5", true],
    ["release_day", "5", "05", true],
    ["release_day", "5", "15", false],
    ["release_day", "5", "Day", false],
    ["release_year", "2024", "2024", true],
    ["release_year", "2024", "2042", false],
    ["release_year", "2024", "", false],
  ] as const)("%s %s against %j gives %s", (kind, wanted, text, expected) => {
    expect(releaseOptionMatches(kind, wanted, text)).toBe(expected);
  });
});
