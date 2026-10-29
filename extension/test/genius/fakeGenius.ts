// A stand-in for Genius's react-select behaviour, laid over the saved edit-form fixture. It reproduces what was
// measured on the live form, and nothing more:
//   - typing (an `input` event) shows suggestions after a short delay, in more than one batch if asked;
//   - suggestions are fuzzy: a made-up name still gets hits, and `Create "..."` comes last;
//   - `aria-activedescendant` names the focused option and starts on the first;
//   - ArrowDown/ArrowUp move it; Enter chooses it, clears the input and shows a chip;
//   - a role row takes one value, after which its input is read-only;
//   - "Add additional credits" appends a row with the next `custom_performances-N-*` ids and focuses its role.
// It also records everything that must never happen: Enter outside an open menu, form submits, Save or Cancel.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { words } from "../../src/core/text";
import { boxOf } from "../../src/genius/selectors";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "tests", "fixtures", "genius-edit-form.html");
const RELEASE_FIXTURE = join(import.meta.dirname, "..", "..", "..", "tests", "fixtures", "genius-release-date.html");

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** How the Release Date dropdowns spell their options: the real texts are not known, so each style is tried. */
export interface ReleaseOptions {
  /** "names" (May), "short" (May, Sep), "numbers" (5), "padded" (05) or "both" (May - 5). Default names. */
  months?: "names" | "short" | "numbers" | "padded" | "both" | "odd";
  /** Days spelled with a leading zero (05). */
  paddedDays?: boolean;
  /** The day options exactly as given, instead of 1 to 31. */
  days?: string[];
  years?: number[];
  /** The Tags and Albums section starts closed (aria-hidden) and opens through its control. */
  collapsed?: boolean;
  /** While closed, the dropdowns are not in the page at all. */
  unmountedWhenCollapsed?: boolean;
  /** Leave out the control that opens the section. */
  noExpander?: boolean;
  /** Leave the Release Date fieldset out of the form. */
  absent?: boolean;
  /** A value the dropdowns already hold, by input label ("Release Month": "May"). */
  preset?: Record<string, string>;
}

export const ARTISTS = [
  "Billie Eilish",
  "Billie Eilish, FINNEAS, Tim Anderson, Aron Forbes",
  "Balarke a.k.a Billie Eilish from BTS",
  "FINNEAS",
  "Finneas Herman",
  "Taylor Swift",
  "99 Neighbors",
  "99 Percent",
  "Nobody Likes You Pat",
];

export const ROLES = [
  "Mixing Engineer",
  "Mastering Engineer",
  "Lead Vocals",
  "Synthesizer",
  "Synthesizer Arranger",
  "Phonographic Copyright ℗",
  "Copyright ©",
];

export interface FakeOptions {
  /** Delay before suggestions appear. */
  suggestionDelayMs?: number;
  /** When set, the exact suggestions arrive this long after a first batch of fuzzy ones. */
  secondBatchAfterMs?: number;
  /** Order of the artist directory; lets a test put the exact match behind another suggestion. */
  artists?: string[];
  roles?: string[];
  /** Start with no additional-credit rows, as on a form that has none yet. */
  noRows?: boolean;
  /** Leave out the Add additional credits button. */
  noAddButton?: boolean;
  /**
   * Hide the additional credits behind an "N additional roles" line with an Expand button, as the live form does for
   * a song that already has some: while collapsed there are no rows and no Add button in the page at all.
   */
  collapsedRoles?: boolean;
  /** How the Release Date dropdowns behave; the fieldset is always in the form unless `absent`. */
  release?: ReleaseOptions;
}

export interface FakeGenius {
  doc: Document;
  form: HTMLFormElement;
  /** What was chosen, in order, as `field: value`. */
  chosen: string[];
  /** Every Enter that reached a combobox, with whether its menu was open. */
  enters: { open: boolean; field: string }[];
  /** Enter presses on inputs that are not comboboxes. */
  strayEnters: string[];
  submits: number;
  saveClicks: number;
  cancelClicks: number;
  /** Key events that reached each plain input. */
  plainKeys: string[];
  /** Fired `input` and `change` events on plain inputs. */
  plainEvents: string[];
  /** How many times the Expand button of the collapsed additional credits was pressed. */
  expands: number;
  /** How many times the control of the Tags and Albums section was pressed. */
  tagsToggles: number;
  /** The option lists of the Release Date dropdowns, by input label. */
  releaseOptions: Record<string, string[]>;
}

const SUGGESTION_LIMIT = 10;

function fuzzyHits(directory: string[], typed: string): string[] {
  const typedWords = words(typed);
  return directory.filter((name) => {
    const nameWords = words(name);
    return typedWords.some((t) => nameWords.some((n) => n.startsWith(t)));
  });
}

function element(doc: Document, tag: string, attrs: Record<string, string> = {}, text = ""): HTMLElement {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text) node.textContent = text;
  return node;
}

export function loadFakeGenius(options: FakeOptions = {}): FakeGenius {
  const html = readFileSync(FIXTURE, "utf-8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const form = doc.querySelector<HTMLFormElement>('form[aria-label="Edit Song Metadata Form"]');
  if (!form) throw new Error("fixture has no edit form");

  const fake: FakeGenius = {
    doc,
    form,
    chosen: [],
    enters: [],
    strayEnters: [],
    submits: 0,
    saveClicks: 0,
    cancelClicks: 0,
    plainKeys: [],
    plainEvents: [],
    expands: 0,
    tagsToggles: 0,
    releaseOptions: {},
  };
  const artists = options.artists ?? ARTISTS;
  const roles = options.roles ?? ROLES;
  const delay = options.suggestionDelayMs ?? 15;

  form.addEventListener("submit", () => fake.submits++);
  doc.querySelector('button[aria-label="Save"]')?.addEventListener("click", () => fake.saveClicks++);
  doc.querySelector('button[aria-label="Cancel"]')?.addEventListener("click", () => fake.cancelClicks++);

  const fieldName = (input: HTMLInputElement): string => {
    const aria = input.getAttribute("aria-label");
    if (aria) return aria;
    const label = input
      .closest("label")
      ?.querySelector("span")
      ?.textContent.replace(/\s+/g, " ")
      .replace(/\*$/, "")
      .trim();
    return label ?? input.closest("[id]")?.id ?? input.id;
  };
  const isRoleBox = (box: HTMLElement): boolean => /^custom_performances-\d+-label$/.test(box.id);

  function closeMenu(input: HTMLInputElement): void {
    doc.getElementById(input.getAttribute("aria-controls") ?? "")?.remove();
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-activedescendant", "");
  }

  function showMenu(input: HTMLInputElement, names: string[], typed: string): void {
    closeMenu(input);
    const base = input.id.replace(/-input$/, "");
    const listbox = element(doc, "div", { id: `${base}-listbox`, role: "listbox", "aria-multiselectable": "true" });
    const shown = names.slice(0, SUGGESTION_LIMIT);
    shown.forEach((name, i) => {
      const option = element(doc, "div", {
        id: `${base}-option-${String(i)}`,
        role: "option",
        "aria-selected": "false",
        tabindex: "-1",
      });
      option.textContent = name;
      listbox.append(option);
    });
    const create = element(doc, "div", {
      id: `${base}-option-${String(shown.length)}`,
      role: "option",
      "aria-selected": "false",
    });
    create.textContent = `Create "${typed}"`;
    listbox.append(create);
    boxOf(input).querySelector(".css-b62m3t-container")?.append(listbox);
    input.setAttribute("aria-controls", listbox.id);
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", `${base}-option-0`);
  }

  function addChip(input: HTMLInputElement, label: string): void {
    const box = boxOf(input);
    box.querySelector('[id$="-placeholder"]')?.remove();
    const chip = element(doc, "div", { class: "css-a69xu0-multiValue" });
    chip.append(
      element(doc, "div", { class: "label" }, `${label} `),
      element(doc, "div", { role: "button", "aria-label": `Remove ${label}`, "aria-hidden": "true" }),
    );
    const holder = box.querySelector(".css-1ygnsa4, .css-bxz0mv") ?? box;
    holder.insertBefore(chip, holder.firstChild);
    input.value = "";
    if (isRoleBox(box)) input.setAttribute("aria-readonly", "true");
  }

  function wire(input: HTMLInputElement): void {
    input.addEventListener("input", () => {
      const box = boxOf(input);
      if (isRoleBox(box) && input.getAttribute("aria-readonly") === "true") return;
      const typed = input.value;
      if (!typed) {
        closeMenu(input);
        return;
      }
      const directory = isRoleBox(box) ? roles : artists;
      const hits = fuzzyHits(directory, typed);
      const exact = hits.filter((name) => words(name).join(" ") === words(typed).join(" ") || name === typed);
      const show = (names: string[]): void => {
        // Typing again replaces the menu; a stale batch for older text must not appear.
        if (input.value !== typed) return;
        showMenu(input, names, typed);
      };
      setTimeout(() => {
        if (options.secondBatchAfterMs && exact.length > 0) {
          show(hits.filter((name) => !exact.includes(name)));
          setTimeout(() => {
            show(hits);
          }, options.secondBatchAfterMs);
        } else {
          show(hits);
        }
      }, delay);
    });

    input.addEventListener("keydown", (event) => {
      const open = input.getAttribute("aria-expanded") === "true";
      if (event.key === "Enter") {
        fake.enters.push({ open, field: fieldName(input) });
        if (!open) return;
        const active = doc.getElementById(input.getAttribute("aria-activedescendant") ?? "");
        const text = active?.textContent.trim() ?? "";
        if (!active || text.startsWith('Create "')) return; // the fake only models choosing an existing entry
        addChip(input, text);
        fake.chosen.push(`${fieldName(input)}: ${text}`);
        closeMenu(input);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const listbox = doc.getElementById(input.getAttribute("aria-controls") ?? "");
      const ids = [...(listbox?.querySelectorAll('[role="option"]') ?? [])].map((o) => o.id);
      const at = ids.indexOf(input.getAttribute("aria-activedescendant") ?? "");
      const next = Math.min(ids.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)));
      if (ids[next]) input.setAttribute("aria-activedescendant", ids[next]);
    });
  }

  for (const input of form.querySelectorAll<HTMLInputElement>('input[role="combobox"]')) wire(input);

  for (const input of form.querySelectorAll<HTMLInputElement>(
    'input[name="youtube_url"], input[name="custom_song_art_image_url"]',
  )) {
    input.addEventListener("keydown", (event) => {
      fake.plainKeys.push(`${input.name}:${event.key}`);
      if (event.key === "Enter") fake.strayEnters.push(input.name);
    });
    for (const type of ["input", "change"])
      input.addEventListener(type, () => fake.plainEvents.push(`${input.name}:${type}`));
  }

  if (!options.release?.absent) addReleaseDate(fake, options.release ?? {}, delay);

  // Additional credits: the fixture holds one empty row to copy from.
  const rows = form.querySelector<HTMLElement>('[class*="RepeatableInputPair__Rows"]');
  const template = rows?.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
  if (options.noRows) rows?.replaceChildren();
  const add = [...form.querySelectorAll("button")].find((b) => b.textContent.trim() === "Add additional credits");
  if (options.noAddButton) add?.remove();
  add?.addEventListener("click", () => {
    if (!rows || !template) return;
    const index = rows.children.length;
    const row = template.cloneNode(true) as HTMLElement;
    for (const node of [row, ...row.querySelectorAll<HTMLElement>("*")]) {
      for (const attr of [...node.attributes]) {
        const value = attr.value
          .replace("custom_performances-0-", `custom_performances-${String(index)}-`)
          .replace(/react-select-18/g, `react-select-${String(200 + index * 2)}`)
          .replace(/react-select-19/g, `react-select-${String(201 + index * 2)}`);
        if (value !== attr.value) node.setAttribute(attr.name, value);
      }
    }
    rows.append(row);
    for (const input of row.querySelectorAll<HTMLInputElement>('input[role="combobox"]')) wire(input);
    row.querySelector<HTMLInputElement>('[id$="-label"] input')?.focus();
  });

  // The captured form is open, so its button reads "Hide": any press of an expander is counted, to catch a fill that
  // would close an open section.
  for (const open of form.querySelectorAll('[data-testid="custom-performances-expander"]')) {
    open.addEventListener("click", () => fake.expands++);
    if (options.collapsedRoles) open.remove();
  }

  if (options.collapsedRoles && rows && add) {
    // The live form shows only "N additional roles" and an Expand button until it is pressed; the rows and the Add
    // button are not in the page meanwhile, and appear a moment after the press.
    let block: HTMLElement | null = rows;
    while (block && !block.contains(add)) block = block.parentElement;
    if (block) {
      const note = element(doc, "div");
      note.append(element(doc, "p", {}, "2 additional roles"));
      const expander = element(
        doc,
        "button",
        { type: "button", "data-testid": "custom-performances-expander" },
        "Expand",
      );
      note.append(expander);
      block.replaceWith(note);
      expander.addEventListener("click", () => {
        fake.expands++;
        setTimeout(() => {
          note.replaceWith(block);
        }, delay);
      });
    }
  }

  return fake;
}

/**
 * The Release Date fieldset, from the captured fixture, inside its collapsible region. Each dropdown is a
 * single-select: typing filters its options (react-select matches the text anywhere in the label), Enter on the focused
 * option shows it as the single value and removes the placeholder.
 */
function addReleaseDate(fake: FakeGenius, release: ReleaseOptions, delay: number): void {
  const { doc, form } = fake;
  const parsed = new DOMParser().parseFromString(readFileSync(RELEASE_FIXTURE, "utf-8"), "text/html");
  const region = parsed.getElementById("collapsible-tags_albums-content");
  if (!region) throw new Error("release fixture has no region");
  const node = doc.importNode(region, true);
  form.append(node);

  const style = release.months ?? "names";
  const monthText = (n: number): string => {
    const name = MONTH_NAMES[n - 1] ?? "";
    switch (style) {
      case "names":
        return name;
      case "short":
        return name.slice(0, 3);
      case "numbers":
        return String(n);
      case "padded":
        return String(n).padStart(2, "0");
      case "both":
        return `${name} - ${String(n)}`;
      case "odd":
        return `Mayo ${String(n)}`; // spellings that must never be taken for a month
    }
  };
  const lists: Record<string, string[]> = {
    "Release Month": Array.from({ length: 12 }, (_, i) => monthText(i + 1)),
    "Release Day":
      release.days ??
      Array.from({ length: 31 }, (_, i) => (release.paddedDays ? String(i + 1).padStart(2, "0") : String(i + 1))),
    "Release Year": (release.years ?? Array.from({ length: 80 }, (_, i) => 2030 - i)).map(String),
  };
  fake.releaseOptions = lists;

  for (const input of node.querySelectorAll<HTMLInputElement>('input[role="combobox"]')) {
    const label = input.getAttribute("aria-label") ?? "";
    const list = lists[label] ?? [];
    const box = (): HTMLElement => {
      let at: HTMLElement = input;
      while (at.parentElement && at.parentElement.querySelectorAll('input[role="combobox"]').length === 1)
        at = at.parentElement;
      return at;
    };
    const closeMenu = (): void => {
      doc.getElementById(input.getAttribute("aria-controls") ?? "")?.remove();
      input.setAttribute("aria-expanded", "false");
      input.setAttribute("aria-activedescendant", "");
    };
    const choose = (text: string): void => {
      box().querySelector('[id$="-placeholder"]')?.remove();
      box().querySelector('[class*="singleValue"]')?.remove();
      const single = element(doc, "div", { class: "css-1dimb5e-singleValue" }, text);
      input.parentElement?.parentElement?.insertBefore(single, input.parentElement);
      input.value = "";
      fake.chosen.push(`${label}: ${text}`);
    };
    if (release.preset?.[label]) choose(release.preset[label]);

    input.addEventListener("input", () => {
      const typed = input.value;
      if (!typed) {
        closeMenu();
        return;
      }
      setTimeout(() => {
        if (input.value !== typed) return;
        closeMenu();
        const base = input.id.replace(/-input$/, "");
        const hits = list.filter((text) => text.toLowerCase().includes(typed.toLowerCase()));
        if (hits.length === 0) return; // react-select shows "No options", which is not an option
        const listbox = element(doc, "div", { id: `${base}-listbox`, role: "listbox" });
        hits.forEach((text, i) => {
          listbox.append(
            element(doc, "div", { id: `${base}-option-${String(i)}`, role: "option", tabindex: "-1" }, text),
          );
        });
        box().querySelector(".css-b62m3t-container")?.append(listbox);
        input.setAttribute("aria-controls", listbox.id);
        input.setAttribute("aria-expanded", "true");
        input.setAttribute("aria-activedescendant", `${base}-option-0`);
      }, delay);
    });
    input.addEventListener("keydown", (event) => {
      const open = input.getAttribute("aria-expanded") === "true";
      if (event.key === "Enter") {
        fake.enters.push({ open, field: label });
        if (!open) return;
        const active = doc.getElementById(input.getAttribute("aria-activedescendant") ?? "");
        if (active) choose(active.textContent.trim());
        closeMenu();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const ids = [
        ...(doc.getElementById(input.getAttribute("aria-controls") ?? "")?.querySelectorAll('[role="option"]') ?? []),
      ].map((o) => o.id);
      const at = ids.indexOf(input.getAttribute("aria-activedescendant") ?? "");
      const next = Math.min(ids.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)));
      if (ids[next]) input.setAttribute("aria-activedescendant", ids[next]);
    });
  }

  // The control of the section: a press toggles it, as the real one would, and is counted.
  const content = [...node.children];
  const setOpen = (open: boolean): void => {
    node.setAttribute("aria-hidden", open ? "false" : "true");
    if (release.unmountedWhenCollapsed) {
      if (open) node.replaceChildren(...content);
      else node.replaceChildren();
    }
  };
  if (!release.noExpander) {
    const control = element(doc, "button", {
      type: "button",
      "aria-controls": "collapsible-tags_albums-content",
      "aria-expanded": release.collapsed ? "false" : "true",
    });
    control.textContent = "Tags and Albums";
    node.before(control);
    control.addEventListener("click", () => {
      fake.tagsToggles++;
      const open = control.getAttribute("aria-expanded") !== "true";
      setTimeout(() => {
        control.setAttribute("aria-expanded", String(open));
        setOpen(open);
      }, delay);
    });
  }
  if (release.collapsed) setOpen(false);
}

/** Chips shown in a field, as their label text. */
export function chipsIn(box: Element | null): string[] {
  return [...(box?.querySelectorAll('[class*="multiValue"]') ?? [])].map((chip) => chip.textContent.trim());
}

export function rowChips(form: HTMLFormElement): { role: string[]; artists: string[] }[] {
  const out: { role: string[]; artists: string[] }[] = [];
  for (let i = 0; form.querySelector(`#custom_performances-${String(i)}-label`); i++) {
    out.push({
      role: chipsIn(form.querySelector(`#custom_performances-${String(i)}-label`)),
      artists: chipsIn(form.querySelector(`#custom_performances-${String(i)}-artists`)),
    });
  }
  return out;
}
