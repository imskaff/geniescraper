import { describe, expect, it } from "vitest";
import { openEditForm } from "../../src/genius/openEdit";

const TIMING = { buttonMs: 150, formMs: 150, pollMs: 5 };
const FORM = 'form[aria-label="Edit Song Metadata Form"]';

interface Page {
  doc: Document;
  clicks: { edit: number; save: number; cancel: number; other: number };
}

function addForm(doc: Document, clicks: Page["clicks"]): void {
  const form = doc.createElement("form");
  form.setAttribute("aria-label", "Edit Song Metadata Form");
  for (const [label, key] of [
    ["Save", "save"],
    ["Cancel", "cancel"],
  ] as const) {
    const button = doc.createElement("button");
    button.setAttribute("aria-label", label);
    button.textContent = label;
    button.addEventListener("click", () => clicks[key]++);
    form.append(button);
  }
  doc.body.append(form);
}

/** A song page as the live site shows it: an Edit Metadata button (signed in), and Save and Cancel only in the form. */
function songPage(options: { button?: boolean; opens?: boolean; buttonAfterMs?: number } = {}): Page {
  const doc = new DOMParser().parseFromString("<body><button>Share</button></body>", "text/html");
  const clicks = { edit: 0, save: 0, cancel: 0, other: 0 };
  doc.querySelector("button")?.addEventListener("click", () => clicks.other++);
  const addButton = (): void => {
    const button = doc.createElement("button");
    button.textContent = " Edit Metadata ";
    button.addEventListener("click", () => {
      clicks.edit++;
      if (options.opens !== false)
        setTimeout(() => {
          addForm(doc, clicks);
        }, 20);
    });
    doc.body.append(button);
  };
  if (options.button !== false) {
    if (options.buttonAfterMs) setTimeout(addButton, options.buttonAfterMs);
    else addButton();
  }
  return { doc, clicks };
}

const NONE = { edit: 0, save: 0, cancel: 0, other: 0 };

describe("openEditForm", () => {
  it("presses Edit Metadata once and reports the form open", async () => {
    const page = songPage();
    expect(await openEditForm(page.doc, TIMING)).toBe("opened");
    expect(page.doc.querySelector(FORM)).not.toBeNull();
    expect(page.clicks).toEqual({ ...NONE, edit: 1 });
  });

  it("waits for a button that appears after the page loaded", async () => {
    const page = songPage({ buttonAfterMs: 40 });
    expect(await openEditForm(page.doc, TIMING)).toBe("opened");
    expect(page.clicks.edit).toBe(1);
  });

  it("does nothing when the form is already open", async () => {
    const page = songPage();
    addForm(page.doc, page.clicks);
    expect(await openEditForm(page.doc, TIMING)).toBe("already-open");
    expect(page.clicks).toEqual(NONE);
  });

  it("counts a form the user opened meanwhile, without pressing anything", async () => {
    const page = songPage({ button: false });
    setTimeout(() => {
      addForm(page.doc, page.clicks);
    }, 30);
    expect(await openEditForm(page.doc, TIMING)).toBe("already-open");
    expect(page.clicks).toEqual(NONE);
  });

  it("says no-button on a signed-out page and presses nothing", async () => {
    const page = songPage({ button: false });
    expect(await openEditForm(page.doc, TIMING)).toBe("no-button");
    expect(page.clicks).toEqual(NONE);
  });

  it("says no-form when the button was pressed and no form came, and presses nothing else", async () => {
    const page = songPage({ opens: false });
    expect(await openEditForm(page.doc, TIMING)).toBe("no-form");
    expect(page.clicks).toEqual({ ...NONE, edit: 1 });
  });

  it("matches the button's text exactly, not a button that merely mentions it", async () => {
    const page = songPage({ button: false });
    const other = page.doc.createElement("button");
    other.textContent = "Edit Metadata for everyone";
    other.addEventListener("click", () => page.clicks.edit++);
    page.doc.body.append(other);
    expect(await openEditForm(page.doc, TIMING)).toBe("no-button");
    expect(page.clicks.edit).toBe(0);
  });
});
