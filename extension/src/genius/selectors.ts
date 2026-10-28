// The only module that knows Genius's edit-form markup. Class names there are hashed and the react-select ids
// change on every open, so fields are found by their visible label, by `name`, and by the stable ids of the
// additional-credit rows. Nothing here ever looks up the Save or Cancel buttons: the extension never presses them.

export const FORM_SELECTOR = 'form[aria-label="Edit Song Metadata Form"]';

export const WRITER_LABEL = "Writer";
export const PRODUCER_LABEL = "Producer";
export const YOUTUBE_INPUT_NAME = "youtube_url";
export const COVER_ART_INPUT_NAME = "custom_song_art_image_url";

const ADD_CREDITS_TEXT = "Add additional credits";
const ROW_ID = /^custom_performances-(\d+)-(label|artists)$/;

export function findForm(doc: Document): HTMLFormElement | null {
  return doc.querySelector<HTMLFormElement>(FORM_SELECTOR);
}

/** The visible text of a field label: no trailing space and no required-field asterisk. */
function labelText(label: Element): string {
  const raw = label.querySelector("span")?.textContent ?? "";
  return raw.replace(/\s+/g, " ").replace(/\*$/, "").trim();
}

/** The combobox input of the field with this label (the label text is what a person sees on screen). */
export function comboboxByLabel(form: HTMLFormElement, text: string): HTMLInputElement | null {
  for (const label of form.querySelectorAll("label")) {
    if (labelText(label) === text) return label.querySelector<HTMLInputElement>('input[role="combobox"]');
  }
  return null;
}

/** A plain text input, such as the YouTube or song art URL. */
export function plainInput(form: HTMLFormElement, name: string): HTMLInputElement | null {
  return form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
}

export function addCreditsButton(form: HTMLFormElement): HTMLButtonElement | null {
  for (const button of form.querySelectorAll("button")) {
    if (button.textContent.trim() === ADD_CREDITS_TEXT) return button;
  }
  return null;
}

/** One additional-credit row: a role and the artists in that role. */
export interface CreditRow {
  index: number;
  roleBox: HTMLElement;
  artistsBox: HTMLElement;
  role: HTMLInputElement;
  artists: HTMLInputElement;
}

/** The rows, in order. A row exists only once both of its fields do. */
export function creditRows(form: HTMLFormElement): CreditRow[] {
  const boxes = new Map<number, { label?: HTMLElement; artists?: HTMLElement }>();
  for (const el of form.querySelectorAll<HTMLElement>('[id^="custom_performances-"]')) {
    const match = ROW_ID.exec(el.id);
    if (!match?.[1]) continue;
    const entry = boxes.get(Number(match[1])) ?? {};
    if (match[2] === "label") entry.label = el;
    else entry.artists = el;
    boxes.set(Number(match[1]), entry);
  }
  const rows: CreditRow[] = [];
  for (const [index, { label, artists }] of [...boxes].sort(([a], [b]) => a - b)) {
    const role = label?.querySelector("input");
    const artistInput = artists?.querySelector("input");
    if (label && artists && role && artistInput) {
      rows.push({ index, roleBox: label, artistsBox: artists, role, artists: artistInput });
    }
  }
  return rows;
}

/**
 * The values already chosen in a field, as the chips it shows. react-select draws every selection as a
 * multi-value chip, including the single role of a credit row; its label is the chip's text.
 */
export function chipTexts(box: Element): string[] {
  return [...box.querySelectorAll('[class*="multiValue"]')].map((chip) => chip.textContent.trim()).filter(Boolean);
}

/**
 * The container that holds a combobox input's chips and suggestions. The input carries role="combobox" itself,
 * so the search starts at its parent.
 */
export function boxOf(input: HTMLInputElement): HTMLElement {
  return input.parentElement?.closest<HTMLElement>('[role="combobox"]') ?? input;
}
