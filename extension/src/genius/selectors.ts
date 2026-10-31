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

/**
 * The button of a song that already has additional roles: the form shows only "N additional roles" and this Expand
 * button until it is pressed, and the rows and the Add button are not in the page meanwhile (seen on a live form).
 */
export const CREDITS_EXPANDER = '[data-testid="custom-performances-expander"]';

export function creditsExpander(form: HTMLFormElement): HTMLButtonElement | null {
  const button = form.querySelector<HTMLButtonElement>(CREDITS_EXPANDER);
  // The same button reads "Hide" once the section is open (the captured open form has it so): pressing it then would
  // close the section again, so only a button that says Expand counts.
  return button && /^Expand\b/i.test(button.textContent.trim()) ? button : null;
}

/**
 * The Release Date fieldset: three single-select comboboxes, found by their aria-label (captured from the live form;
 * their react-select ids change on every open). They live in the collapsible Tags and Albums region, which can be
 * closed, and then its content is hidden. ASSUMED, not yet confirmed on a live form: the control that opens the region
 * carries aria-controls with the region's id and an aria-expanded state; a closed region has aria-hidden="true".
 */
export const RELEASE_LABELS = {
  release_month: "Release Month",
  release_day: "Release Day",
  release_year: "Release Year",
} as const;

export const TAGS_REGION_ID = "collapsible-tags_albums-content";

export function releaseInput(doc: Document, label: string): HTMLInputElement | null {
  return doc.querySelector<HTMLInputElement>(`input[role="combobox"][aria-label="${label}"]`);
}

/** Whether the Tags and Albums region is closed (its content is hidden). False when the page has no such region. */
export function tagsCollapsed(doc: Document): boolean {
  return doc.getElementById(TAGS_REGION_ID)?.getAttribute("aria-hidden") === "true";
}

/** The control that opens the Tags and Albums region, only while the region is closed: never one that would close it. */
export function tagsExpander(doc: Document): HTMLElement | null {
  const control = doc.querySelector<HTMLElement>(`[aria-controls="${TAGS_REGION_ID}"]`);
  if (!control) return null;
  const expanded = control.getAttribute("aria-expanded");
  return expanded === "false" || (expanded === null && tagsCollapsed(doc)) ? control : null;
}

/**
 * The box of a single-select dropdown that holds its chosen value: the largest ancestor of the input that contains no
 * other combobox. (react-select's own classes are hashed, so none is relied on.)
 */
export function dropdownBox(input: HTMLInputElement): HTMLElement {
  let box: HTMLElement = input;
  for (;;) {
    const parent = box.parentElement;
    if (!parent || parent.querySelectorAll('input[role="combobox"]').length !== 1) return box;
    box = parent;
  }
}

/** The value a single-select dropdown shows ("" while it is empty and shows its placeholder). */
export function singleValueText(box: Element): string {
  return box.querySelector('[class*="singleValue"]')?.textContent.trim() ?? "";
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

const EDIT_METADATA_TEXT = "Edit Metadata";

/**
 * The song page's Edit Metadata button, which opens the form. It only exists for a signed-in user, and it is the one
 * control the extension presses outside the form: there is no address that opens the form directly.
 */
export function editMetadataButton(doc: Document): HTMLButtonElement | null {
  for (const button of doc.querySelectorAll("button")) {
    if (button.textContent.trim() === EDIT_METADATA_TEXT) return button;
  }
  return null;
}
