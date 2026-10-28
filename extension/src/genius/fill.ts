// Fills ONE step of the paste queue into the open Genius edit form, and reports what happened.
//
// Each press fills one field, targeted directly, so the Tab counts of the desktop app's Auto-Tab are not needed.
// Rules that tests pin:
//   - never press Save or Cancel, and never submit the form;
//   - Enter goes only to a combobox with its menu open, on an option that is an exact match;
//   - when nothing matches exactly, the text stays typed and the user decides: a fuzzy first suggestion
//     (measured: "99 Neighbors" for a made-up name) is never picked on their behalf;
//   - plain inputs get a value and input/change events, never key presses.
import type { QueueItem } from "../core/models";
import { sleep } from "../apple/wait";
import { chooseOption, sameName, setValue, suggestionsFor, waitForChip, type ComboboxTiming } from "./combobox";
import {
  COVER_ART_INPUT_NAME,
  PRODUCER_LABEL,
  WRITER_LABEL,
  YOUTUBE_INPUT_NAME,
  addCreditsButton,
  boxOf,
  chipTexts,
  comboboxByLabel,
  creditRows,
  findForm,
  plainInput,
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

/** The row a role goes into: the last one if its role is still empty, otherwise a new one. */
async function rowForNewRole(form: HTMLFormElement, ctx: FillContext): Promise<CreditRow | null> {
  const last = lastRow(form);
  if (last && chipTexts(last.roleBox).length === 0) return last;

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

/**
 * Whether the user has put this step's value on the form themselves: its chip is in the field, or the plain field
 * holds it. An automatic run waits for exactly this after a step that needed the user's choice.
 */
export function isStepDone(doc: Document, item: QueueItem): boolean {
  const form = findForm(doc);
  if (!form) return false;
  const [kind, value] = item;
  const has = (box: Element | undefined): boolean =>
    box !== undefined && chipTexts(box).some((c) => sameName(c, value));
  switch (kind) {
    case "written_by":
    case "produced_by": {
      const input = comboboxByLabel(form, kind === "written_by" ? WRITER_LABEL : PRODUCER_LABEL);
      return input ? has(boxOf(input)) : false;
    }
    case "role":
    case "copyright_role":
      return has(lastRow(form)?.roleBox);
    case "artist":
    case "phonographic_copyright":
    case "copyright_notice":
      return has(lastRow(form)?.artistsBox);
    case "youtube_url":
      return plainInput(form, YOUTUBE_INPUT_NAME)?.value === value;
    case "cover_art":
      return plainInput(form, COVER_ART_INPUT_NAME)?.value === value;
  }
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
      const row = await rowForNewRole(form, ctx);
      if (!row) return { status: "unavailable", message: "Genius has no Add additional credits button on this form." };
      return fillCombobox(row.role, row.roleBox, value, ctx);
    }
    case "artist":
    case "phonographic_copyright":
    case "copyright_notice": {
      const row = lastRow(form);
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
  }
}
