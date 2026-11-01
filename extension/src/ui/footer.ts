// The small credit line under the panel. Two plain links that open in a new tab; nothing is requested or sent.
import { el } from "./dom";

export const AUTHOR_URL = "https://github.com/imskaff";
export const SUPPORT_URL = "https://buymeacoffee.com/imskaff";

const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

export function footer(): HTMLElement {
  return el(
    "footer",
    { class: "credit" },
    "by ",
    el("a", { text: "imskaff", attrs: { href: AUTHOR_URL, ...NEW_TAB } }),
    " · ",
    el("a", { text: "buy me a coffee", attrs: { href: SUPPORT_URL, ...NEW_TAB } }),
  );
}
