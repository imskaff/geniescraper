// Fills ONE step of the paste queue into the open Genius edit form, and reports what happened.
//
// Each press fills one field, targeted directly, so the Tab counts of the desktop app's Auto-Tab are not needed.
// Rules that tests pin:
//   - never press Save or Cancel, and never submit the form;
//   - Enter goes only to a combobox with its menu open, on an option that is an exact match;
//   - when nothing matches exactly, the text stays typed and the user decides: a fuzzy first suggestion
//     (measured: "99 Neighbors" for a made-up name) is never picked on their behalf;
//   - plain inputs get a value and input/change events, never key presses.
import type { QueueItem, QueueKind } from "../core/models";
import { sleep } from "../apple/wait";
import { MONTHS } from "../core/releaseDate";
import { words } from "../core/text";
import {
  chooseOption,
  sameName,
  setValue,
  suggestionsFor,
  waitForChip,
  waitFor,
  type ComboboxTiming,
} from "./combobox";
import {
  COVER_ART_INPUT_NAME,
  PRODUCER_LABEL,
  RELEASE_LABELS,
  WRITER_LABEL,
  YOUTUBE_INPUT_NAME,
  addCreditsButton,
  creditsExpander,
  boxOf,
  chipTexts,
  comboboxByLabel,
  creditRows,
  dropdownBox,
  findForm,
  plainInput,
  releaseInput,
  singleValueText,
  tagsCollapsed,
  tagsExpander,
  type CreditRow,
} from "./selectors";

export type StepOutcome =
  /** The value is in the field (or was already there). */
  | { status: "filled"; message: string }
  /** The text is typed but the user has to choose: no exact match, or auto-confirm is off. */
  | { status: "needs-choice"; message: string }
  /** The form or field is not there to fill. */
  | { status: "unavailable"; message: string };

export interface FillContext {
  doc: Document;
  timing: ComboboxTiming;
  /** Choose the exact match without asking. When false every combobox step is left for the user. */
  autoConfirm: boolean;
  /** An automatic run is filling: the wording does not ask the user to press the Next key. */
  auto?: boolean;
  /** For an artist step: the additional role it belongs to, so it goes under that role's row whichever row that is. */
  role?: string;
}

export const REAL_COMBOBOX_TIMING: ComboboxTiming = { suggestionMs: 4_000, settleMs: 600, selectMs: 1_500, pollMs: 50 };

const NO_FORM = "Open the song's Edit Metadata form on Genius first.";

function bringIntoView(el: HTMLElement): void {
  // Not every environment implements scrolling; the fill works either way.
  if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
}

/** A combobox step: type the value, then choose the exact match if there is one. */
async function fillCombobox(
  input: HTMLInputElement,
  box: HTMLElement,
  value: string,
  ctx: FillContext,
): Promise<StepOutcome> {
  if (chipTexts(box).some((chip) => sameName(chip, value))) {
    return { status: "filled", message: `${value} was already there.` };
  }
  bringIntoView(input);
  const options = await suggestionsFor(input, value, ctx.timing);

  if (!ctx.autoConfirm) {
    return {
      status: "needs-choice",
      message: ctx.auto
        ? `Typed ${value}. Choose it from the suggestions and automatic pasting carries on.`
        : `Typed ${value}. Choose it from the suggestions, then press Next.`,
    };
  }
  const exact = options.find((option) => sameName(option.textContent, value));
  if (!exact) {
    // The live form always ends its list with a Create "..." entry; that is not a suggestion.
    const suggested = options.filter((option) => !/^Create\b/.test(option.textContent.trim()));
    const message =
      suggested.length > 0
        ? `Genius has no exact match for ${value}. Choose a suggestion yourself, or press Skip.`
        : `Genius has nothing for ${value}. Choose something yourself, or press Skip.`;
    return { status: "needs-choice", message };
  }
  if (!(await chooseOption(input, exact, ctx.timing)) || !(await waitForChip(box, value, ctx.timing))) {
    return { status: "needs-choice", message: `Could not confirm ${value}. Choose it yourself, or press Skip.` };
  }
  return { status: "filled", message: `Added ${value}.` };
}

function lastRow(form: HTMLFormElement): CreditRow | undefined {
  return creditRows(form).at(-1);
}

/**
 * Open the additional credits when the form shows them collapsed behind "N additional roles" and Expand. Pressing
 * Expand only reveals what the song already has: it saves nothing. Resolves once the rows or the Add button are in
 * the page, or the time is up; with nothing collapsed it does nothing.
 */
async function openCredits(form: HTMLFormElement, ctx: FillContext): Promise<void> {
  const expander = creditsExpander(form);
  if (!expander) return;
  expander.click();
  const deadline = Date.now() + ctx.timing.selectMs;
  while (Date.now() < deadline && creditRows(form).length === 0 && !addCreditsButton(form)) {
    await sleep(ctx.timing.pollMs);
  }
}

/** The row the form already has for this role, wherever it is: a song pasted before keeps its rows. */
function rowForRole(form: HTMLFormElement, role: string): CreditRow | undefined {
  return creditRows(form).find((row) => chipTexts(row.roleBox).some((chip) => sameName(chip, role)));
}

/** The row an artist goes into: that of its own role if the form has one, otherwise the last row. */
function rowForArtist(form: HTMLFormElement, role: string | undefined): CreditRow | undefined {
  return (role ? rowForRole(form, role) : undefined) ?? lastRow(form);
}

/** The row a role goes into: an empty one if the form has any, otherwise a new one. */
async function rowForNewRole(form: HTMLFormElement, ctx: FillContext): Promise<CreditRow | null> {
  await openCredits(form, ctx);
  // An empty row is used before a new one is added, wherever it is: a role that was skipped leaves its row empty, and
  // the next run (or the next role) would otherwise add another beside it. The last empty row goes first, as before.
  const empty = [...creditRows(form)].reverse().find((row) => chipTexts(row.roleBox).length === 0);
  if (empty) return empty;

  const add = addCreditsButton(form);
  if (!add) return null;
  const before = creditRows(form).length;
  add.click();
  const deadline = Date.now() + ctx.timing.selectMs;
  while (Date.now() < deadline && creditRows(form).length <= before) await sleep(ctx.timing.pollMs);
  return lastRow(form) ?? null;
}

function fillPlain(form: HTMLFormElement, name: string, value: string, label: string): StepOutcome {
  const input = plainInput(form, name);
  if (!input) return { status: "unavailable", message: `The ${label} field is not on the form.` };
  bringIntoView(input);
  input.focus();
  setValue(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return input.value === value
    ? { status: "filled", message: `Set the ${label}.` }
    : { status: "needs-choice", message: `Genius did not keep the ${label}. Paste it yourself: ${value}` };
}

// ── release date ──────────────────────────────────────────────────────────

type ReleaseKind = keyof typeof RELEASE_LABELS;

const isReleaseKind = (kind: QueueKind): kind is ReleaseKind => kind in RELEASE_LABELS;

const RELEASE_NOUN: Record<ReleaseKind, string> = {
  release_month: "release month",
  release_day: "release day",
  release_year: "release year",
};

const OPEN_TAGS = "Open the Tags and Albums section, then press Next.";

/**
 * Whether a dropdown's option (or chosen value) text is the date part this step means. The real form lists the full
 * month names, days 1 to 31 and years from 2027 down (checked live), and this also accepts the other plausible
 * spellings, and nothing else:
 *   - month: the month's name ("May"), its three-letter form ("May", "Sep", "Sept") or its number ("5", "05"), alone
 *     or together as "May - 5" / "5 May"; case and accents are ignored;
 *   - day and year: numeric equality, so "05" is 5.
 * Anything else, such as "Mayo" or "15" for the 5th, is not a match.
 */
export function releaseOptionMatches(kind: ReleaseKind, wanted: string, shown: string): boolean {
  const tokens = words(shown);
  if (kind !== "release_month") {
    const [only] = tokens;
    return tokens.length === 1 && only !== undefined && /^\d+$/.test(only) && Number(only) === Number(wanted);
  }
  const month = MONTHS.findIndex((name) => sameName(name, wanted)) + 1;
  if (month === 0) return false;
  const name = words(MONTHS[month - 1] ?? "")[0] ?? "";
  const isName = (token: string): boolean =>
    token === name || token === name.slice(0, 3) || (month === 9 && token === "sept");
  const isNumber = (token: string): boolean => /^\d+$/.test(token) && Number(token) === month;
  const [a, b] = tokens;
  if (a === undefined) return false;
  if (tokens.length === 1) return isName(a) || isNumber(a);
  if (tokens.length === 2 && b !== undefined) return (isName(a) && isNumber(b)) || (isNumber(a) && isName(b));
  return false;
}

/** What to type into the dropdown, in order: the value itself, and for a month its number if the names find nothing. */
function releaseTexts(kind: ReleaseKind, value: string): string[] {
  const month = MONTHS.findIndex((name) => sameName(name, value)) + 1;
  return kind === "release_month" && month > 0 ? [value, String(month)] : [value];
}

/**
 * Open the Tags and Albums section when it is closed and the dropdowns are not reachable. Only ever opens it: a
 * section that is already open is left alone. Resolves true when it pressed the control.
 */
async function openTags(doc: Document, ctx: FillContext, label: string): Promise<boolean> {
  if (releaseInput(doc, label) && !tagsCollapsed(doc)) return false;
  const expander = tagsExpander(doc);
  if (!expander) return false;
  expander.click();
  await waitFor(() => releaseInput(doc, label) !== null && !tagsCollapsed(doc), ctx.timing);
  return true;
}

/**
 * The dropdowns whose value means Genius already had a date before this run. The steps run month, day, year, so the
 * month may have been chosen a moment ago by this very run and must not stop the day, and a day not the year.
 */
const KEPT_BY: Record<ReleaseKind, readonly ReleaseKind[]> = {
  release_month: ["release_month", "release_day", "release_year"],
  release_day: ["release_day", "release_year"],
  release_year: ["release_year"],
};

/** What the form already shows as its release date, as text ("June 9, 2023"), or "" when none of the relevant dropdowns holds one. */
function existingDate(doc: Document, kind: ReleaseKind): string {
  const shownOf = (k: ReleaseKind): string => {
    const input = releaseInput(doc, RELEASE_LABELS[k]);
    return input ? singleValueText(dropdownBox(input)) : "";
  };
  if (!KEPT_BY[kind].some((k) => shownOf(k) !== "")) return "";
  const [month, day, year] = [shownOf("release_month"), shownOf("release_day"), shownOf("release_year")];
  return [[month, day].filter(Boolean).join(" "), year].filter(Boolean).join(", ");
}

async function fillRelease(kind: ReleaseKind, value: string, ctx: FillContext): Promise<StepOutcome> {
  const label = RELEASE_LABELS[kind];
  const noun = RELEASE_NOUN[kind];
  const opened = await openTags(ctx.doc, ctx, label);
  const input = releaseInput(ctx.doc, label);
  if (!input || tagsCollapsed(ctx.doc)) return { status: "unavailable", message: OPEN_TAGS };
  const box = dropdownBox(input);
  const prefix = opened ? "Opened the Tags and Albums section. " : "";

  const current = singleValueText(box);
  if (releaseOptionMatches(kind, value, current)) {
    return { status: "filled", message: `${prefix}The ${noun} was already ${current}.` };
  }
  // A date Genius already has is kept: it may be a better one than Apple's, and half of one date with half of
  // another would be wrong. Only dropdowns this run cannot have filled yet are looked at (see KEPT_BY).
  const kept = existingDate(ctx.doc, kind);
  if (kept) {
    return {
      status: "filled",
      message: `${prefix}Genius already has a release date (${kept}), so it was left as it is.`,
    };
  }
  bringIntoView(input);

  const tried: { text: string; options: HTMLElement[] }[] = [];
  for (const text of releaseTexts(kind, value)) {
    const options = await suggestionsFor(input, text, ctx.timing);
    tried.push({ text, options });
    if (!ctx.autoConfirm) {
      return {
        status: "needs-choice",
        message: `${prefix}Typed ${text}. Choose the ${noun} from the list${ctx.auto ? " and automatic pasting carries on" : ", then press Next"}.`,
      };
    }
    // Only an option that is exactly this value is ever chosen, and only when it is the only one.
    const matching = options.filter((option) => releaseOptionMatches(kind, value, option.textContent));
    if (matching.length > 1) {
      return {
        status: "needs-choice",
        message: `${prefix}Genius lists the ${noun} ${value} more than once. Choose it yourself, or press Skip.`,
      };
    }
    const [exact] = matching;
    if (exact) {
      const chosen =
        (await chooseOption(input, exact, ctx.timing)) &&
        (await waitFor(() => releaseOptionMatches(kind, value, singleValueText(box)), ctx.timing));
      return chosen
        ? { status: "filled", message: `${prefix}Set the ${noun} to ${value}.` }
        : {
            status: "needs-choice",
            message: `${prefix}Could not confirm the ${noun} ${value}. Choose it yourself, or press Skip.`,
          };
    }
  }
  // Nothing matched: leave what the user can use, the typing that found the most suggestions and its list.
  const best = tried.reduce((most, one) => (one.options.length > most.options.length ? one : most));
  if (best !== tried.at(-1)) await suggestionsFor(input, best.text, ctx.timing);
  return {
    status: "needs-choice",
    message: `${prefix}Genius has no exact match for the ${noun} ${value}. Choose it yourself, or press Skip.`,
  };
}

/** The field a step goes into: a combobox's box (where chosen values show as chips), or a plain input. */
function stepField(
  form: HTMLFormElement,
  kind: QueueKind,
  role?: string,
): { box?: Element | undefined; input?: HTMLInputElement | undefined } {
  switch (kind) {
    case "written_by":
    case "produced_by": {
      const input = comboboxByLabel(form, kind === "written_by" ? WRITER_LABEL : PRODUCER_LABEL);
      return input ? { box: boxOf(input), input } : {};
    }
    case "role":
    case "copyright_role":
      // The row a role goes into is any empty one, so it is not tracked here: see roleChips and clearTyped.
      return {};
    case "artist":
    case "phonographic_copyright":
    case "copyright_notice": {
      const row = rowForArtist(form, role);
      return { box: row?.artistsBox, input: row?.artists };
    }
    case "youtube_url":
      return { input: plainInput(form, YOUTUBE_INPUT_NAME) ?? undefined };
    case "cover_art":
      return { input: plainInput(form, COVER_ART_INPUT_NAME) ?? undefined };
    case "release_month":
    case "release_day":
    case "release_year": {
      const input = releaseInput(form.ownerDocument, RELEASE_LABELS[kind]);
      return input ? { box: dropdownBox(input), input } : {};
    }
  }
}

const isRoleStep = (kind: QueueKind): boolean => kind === "role" || kind === "copyright_role";

/** Every role chosen in any row: a role goes into whichever row is empty, so a new one is seen across all of them. */
function roleChips(form: HTMLFormElement): string[] {
  return creditRows(form).flatMap((row) => chipTexts(row.roleBox));
}

/** What a step's field holds right now: its chips, or its value. The user's choice is what changes this afterwards. */
export function stepSnapshot(doc: Document, item: QueueItem, role?: string): string[] {
  const form = findForm(doc);
  if (!form) return [];
  if (isRoleStep(item[0])) return roleChips(form);
  const { box, input } = stepField(form, item[0], role);
  if (box && isReleaseKind(item[0])) {
    const value = singleValueText(box);
    return value ? [value] : [];
  }
  if (box) return chipTexts(box);
  return input ? [input.value] : [];
}

/**
 * Whether the user has resolved a step that needed their choice. They usually pick what Genius calls the person or
 * the label, which is not spelled as Apple spells it, so waiting for Apple's exact name would wait for ever: the step
 * is done once something new is in its field since `before` (a chip, or a changed value), or the exact name is.
 */
export function isStepDone(doc: Document, item: QueueItem, before: readonly string[], role?: string): boolean {
  const form = findForm(doc);
  if (!form) return false;
  const value = item[1];
  if (isRoleStep(item[0])) {
    const chips = roleChips(form);
    return chips.some((chip) => sameName(chip, value)) || chips.length > before.length;
  }
  const { box, input } = stepField(form, item[0], role);
  if (box && isReleaseKind(item[0])) {
    // A single value: done once it is the one wanted, or the user chose another where nothing (or something else) was.
    const shown = singleValueText(box);
    return releaseOptionMatches(item[0], value, shown) || (shown !== "" && shown !== (before[0] ?? ""));
  }
  if (box) {
    const chips = chipTexts(box);
    return chips.some((chip) => sameName(chip, value)) || chips.length > before.length;
  }
  if (input) return input.value === value || (input.value.trim() !== "" && input.value !== (before[0] ?? ""));
  return false;
}

/**
 * Take back what a step typed that was never chosen, when the user skips it. Text left in a combobox can become a new
 * artist page when Genius's form is saved, and nobody asked for that. Only the typed text goes: chips already chosen
 * stay, and plain fields (the YouTube link, the cover) are not touched.
 */
export function clearTyped(doc: Document, item: QueueItem, role?: string): void {
  const form = findForm(doc);
  if (!form) return;
  if (isRoleStep(item[0])) {
    // The text is in the role field of whichever empty row the role went into.
    for (const row of creditRows(form)) {
      if (chipTexts(row.roleBox).length === 0 && row.role.value !== "") setValue(row.role, "");
    }
    return;
  }
  const { box, input } = stepField(form, item[0], role);
  if (box && input && input.value !== "") setValue(input, "");
}

export async function fillStep(item: QueueItem, ctx: FillContext): Promise<StepOutcome> {
  const form = findForm(ctx.doc);
  if (!form) return { status: "unavailable", message: NO_FORM };
  const [kind, value] = item;

  switch (kind) {
    case "written_by":
    case "produced_by": {
      const label = kind === "written_by" ? WRITER_LABEL : PRODUCER_LABEL;
      const input = comboboxByLabel(form, label);
      if (!input) return { status: "unavailable", message: `The ${label} field is not on the form.` };
      return fillCombobox(input, boxOf(input), value, ctx);
    }
    case "role":
    case "copyright_role": {
      // A role the form already has is not added again: its artists go into the row it has.
      await openCredits(form, ctx);
      if (rowForRole(form, value)) return { status: "filled", message: `${value} was already there.` };
      const row = await rowForNewRole(form, ctx);
      if (!row) return { status: "unavailable", message: "Genius has no Add additional credits button on this form." };
      return fillCombobox(row.role, row.roleBox, value, ctx);
    }
    case "artist":
    case "phonographic_copyright":
    case "copyright_notice": {
      // An artist step can come first when its role was skipped on a previous run: open the credits to look.
      await openCredits(form, ctx);
      const row = rowForArtist(form, ctx.role);
      if (!row) {
        return { status: "unavailable", message: "Add the role first: there is no additional credit to put this in." };
      }
      // An artist goes under the row's role. If that role was skipped or never confirmed, filing the artist here would
      // put them under whichever role is chosen for this row next.
      if (chipTexts(row.roleBox).length === 0) {
        return {
          status: "unavailable",
          message: `The role for ${value} is not set. Choose the role on Genius, or press Skip.`,
        };
      }
      return fillCombobox(row.artists, row.artistsBox, value, ctx);
    }
    case "youtube_url":
      return fillPlain(form, YOUTUBE_INPUT_NAME, value, "YouTube URL");
    case "cover_art":
      return fillPlain(form, COVER_ART_INPUT_NAME, value, "song art URL");
    case "release_month":
    case "release_day":
    case "release_year":
      return fillRelease(kind, value, ctx);
  }
}
