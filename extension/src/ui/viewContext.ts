// What the screen modules may use of the view: the controller, the root, the drafts that survive a re-render, and
// the few helpers every screen shares. Keeping it an interface lets the screens live in their own files.
import type { PanelController } from "./controller";

export interface ViewContext {
  readonly root: HTMLElement;
  readonly panel: PanelController;
  /** What the user typed into the link box. */
  draft: string | null;
  /** What the user has typed into the key box, never stored by the view. */
  keyDraft: string;
  /** What the user has typed into the pairing code box. */
  codeDraft: string;
  /** What the user typed into the YouTube link box, and for which track. */
  linkDraft: { index: number; text: string } | null;
  shownErrorSeq: number;
  render(): void;
  keyBusy(): boolean;
  heading(text: string): HTMLElement;
  disclosure(id: string, summary: string, body: Node, openByDefault?: boolean): HTMLElement;
  button(
    text: string,
    variant: "primary" | "quiet" | "nav",
    key: string,
    onClick: () => void,
    disabled: boolean,
    wide?: boolean,
  ): HTMLElement;
}
