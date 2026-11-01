// Types for the tests; the reader itself is plain JavaScript so its text can be injected into a page.
export interface DialogRow {
  section: string;
  sectionIndex: number;
  name: string;
  roles: string[];
  artistId: string | null;
}
export interface ParsedDialog {
  heading: string;
  title: string;
  sections: string[];
  rows: DialogRow[];
  source: string;
}
export type ReadStatus = "ok" | "no-credits" | "no-button" | "no-menu" | "no-item" | "no-dialog" | "blocked";
export interface ReadResult extends Partial<ParsedDialog> {
  status: ReadStatus;
  attempt?: number;
  how?: string;
  menu?: string[];
  steps: Record<string, number>;
}
export interface TrackRow {
  id: string;
  title: string;
  number: number | null;
  explicit: boolean;
  el: Element;
  more: HTMLElement | null;
}
export interface Reader {
  findMoreButton(doc: Document): HTMLElement | null;
  trackRows(doc: Document): TrackRow[];
  readAlbumTrackCount(doc: Document): number | null;
  findCreditsItem(doc: Document): { el: HTMLElement; how: string } | null;
  findDialog(doc: Document): HTMLDialogElement | null;
  parseDialog(dialog: Element): ParsedDialog;
  sanitizeDialog(dialog: Element): string;
  readHeader(doc: Document): {
    title: string;
    artists: string[];
    albumId: string | null;
    year: string;
    cover: string | null;
  };
  readCopyright(doc: Document): { copyright: string; phonographic: string };
  readMeta(doc: Document): Record<string, string | number>;
  readCredits(
    doc: Document,
    options?: {
      button?: HTMLElement;
      timeoutMs?: number;
      attempts?: number;
      menuMs?: number;
      dialogMs?: number;
      capture?: boolean;
    },
  ): Promise<ReadResult>;
  closeDialog(doc: Document): Promise<boolean>;
}
export declare function spotifyReader(): Reader;
export declare const readerSource: string;
export declare function spotifyUrl(kind: "track" | "album", id: string, options?: { intl?: string }): string;
