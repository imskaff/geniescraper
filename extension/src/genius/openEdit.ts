// Opening a song's Edit Metadata form from its page, for the "Open on Genius" action. The one control pressed is
// the Edit Metadata button; Save and Cancel are never looked for, and nothing else on the page is touched.
import { waitFor } from "../apple/wait";
import type { OpenEditState } from "../shared/messages";
import { editMetadataButton, findForm } from "./selectors";

export interface OpenEditTiming {
  /** How long the Edit Metadata button may take to appear on a freshly loaded page. */
  buttonMs: number;
  /** How long the form may take to appear after the button was pressed. */
  formMs: number;
  pollMs: number;
}

export const REAL_OPEN_EDIT_TIMING: OpenEditTiming = { buttonMs: 8000, formMs: 8000, pollMs: 250 };

/**
 * Make sure the song's edit form is open. "no-button" means Genius showed no Edit Metadata button, which is what a
 * signed-out visitor sees; "no-form" means the button was pressed and no form came (for example a dialog that
 * swallowed the click). The page's own dialogs are never answered.
 */
export async function openEditForm(doc: Document, timing: OpenEditTiming): Promise<OpenEditState> {
  // The user may open the form themselves while the page settles: that counts too.
  const ready = (): "form" | HTMLButtonElement | null => (findForm(doc) ? "form" : editMetadataButton(doc));
  const found = await waitFor(doc, ready, timing.buttonMs, timing.pollMs);
  if (found === null) return "no-button";
  if (found === "form") return "already-open";
  found.click();
  const form = await waitFor(doc, () => findForm(doc), timing.formMs, timing.pollMs);
  return form ? "opened" : "no-form";
}
