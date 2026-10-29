// Driving Genius's react-select fields with synthetic events, the way the live form was measured to accept them:
// a value set through the native setter plus an `input` event makes the suggestions appear; ArrowDown moves
// `aria-activedescendant` to the next option; Enter chooses the focused one.
//
// Hard rule: Enter is only ever sent to a combobox whose menu is open and whose focused option is the exact one
// we meant to choose. An Enter anywhere else could submit the form.
import { words } from "../core/text";
import { sleep } from "../apple/wait";
import { chipTexts } from "./selectors";

export interface ComboboxTiming {
  /** Longest wait for the first suggestions after typing. */
  suggestionMs: number;
  /** How long the suggestion list must stay unchanged before it is trusted. */
  settleMs: number;
  /** Longest wait for a chosen value to show up as a chip. */
  selectMs: number;
  pollMs: number;
}

/** Same name, ignoring case, accents and symbols such as the ℗ and © that Genius adds to copyright roles. */
export function sameName(shown: string, wanted: string): boolean {
  const a = words(shown);
  const b = words(wanted);
  return a.length > 0 && a.length === b.length && a.every((word, i) => word === b[i]);
}

// The setter lives on the prototype, below the per-element override React installs to track changes.
const valueSetter: unknown = Reflect.get(
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") ?? {},
  "set",
);

/** Set a controlled input's value the way React notices: through the prototype's setter, then an input event. */
export function setValue(input: HTMLInputElement, text: string): void {
  if (typeof valueSetter === "function") Reflect.apply(valueSetter, input, [text]);
  else input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressKey(input: HTMLInputElement, key: string): void {
  for (const type of ["keydown", "keyup"]) {
    input.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }));
  }
}

export function optionsOf(input: HTMLInputElement): HTMLElement[] {
  const listbox = input.ownerDocument.getElementById(input.getAttribute("aria-controls") ?? "");
  return listbox ? [...listbox.querySelectorAll<HTMLElement>('[role="option"]')] : [];
}

const signature = (options: HTMLElement[]): string => options.map((option) => option.textContent).join("|");

/** Type into a field and wait for its suggestions to arrive and stop changing. */
export async function suggestionsFor(
  input: HTMLInputElement,
  text: string,
  timing: ComboboxTiming,
): Promise<HTMLElement[]> {
  input.focus();
  setValue(input, text);

  const deadline = Date.now() + timing.suggestionMs;
  while (Date.now() < deadline && optionsOf(input).length === 0) await sleep(timing.pollMs);

  // Results can arrive in more than one batch: trust the list once it has held still.
  let last = signature(optionsOf(input));
  let stableSince = Date.now();
  while (Date.now() < deadline && Date.now() - stableSince < timing.settleMs) {
    await sleep(timing.pollMs);
    const now = signature(optionsOf(input));
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    }
  }
  return optionsOf(input);
}

/** Move the focus to `option` with ArrowDown/ArrowUp, then press Enter. False when it could not be reached. */
export async function chooseOption(
  input: HTMLInputElement,
  option: HTMLElement,
  timing: ComboboxTiming,
): Promise<boolean> {
  if (input.getAttribute("aria-expanded") !== "true" || !option.id) return false;
  const options = optionsOf(input);
  const target = options.indexOf(option);
  if (target === -1) return false;

  for (let step = 0; step <= options.length; step++) {
    const focused = input.getAttribute("aria-activedescendant");
    if (focused === option.id) {
      pressKey(input, "Enter");
      return true;
    }
    const at = options.findIndex((o) => o.id === focused);
    pressKey(input, at < target ? "ArrowDown" : "ArrowUp");
    const before = focused;
    const until = Date.now() + timing.selectMs;
    while (Date.now() < until && input.getAttribute("aria-activedescendant") === before) await sleep(timing.pollMs);
  }
  return false;
}

/** Poll until `done()` is true or the select timeout is up; the answer is whether it became true. */
export async function waitFor(done: () => boolean, timing: ComboboxTiming): Promise<boolean> {
  const deadline = Date.now() + timing.selectMs;
  while (Date.now() < deadline) {
    if (done()) return true;
    await sleep(timing.pollMs);
  }
  return done();
}

/** Wait for `text` to appear as a chip in `box`. */
export async function waitForChip(box: Element, text: string, timing: ComboboxTiming): Promise<boolean> {
  const deadline = Date.now() + timing.selectMs;
  while (Date.now() < deadline) {
    if (chipTexts(box).some((chip) => sameName(chip, text))) return true;
    await sleep(timing.pollMs);
  }
  return chipTexts(box).some((chip) => sameName(chip, text));
}
