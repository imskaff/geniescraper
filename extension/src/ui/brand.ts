// Colors the names "Apple Music" and "Spotify" in the panel's visible text (the owner's experiment). Removing the
// feature: revert the commit that added this file. Text only ever reaches the page as text nodes, never as markup.

const NAMES = /(Apple Music|Spotify)/g;

/** The text as nodes, each provider name wrapped in a `brand-apple` or `brand-spotify` span. */
export function brandNodes(text: string): (Text | HTMLSpanElement)[] {
  return text
    .split(NAMES)
    .filter((part) => part !== "")
    .map((part) => {
      if (part !== "Apple Music" && part !== "Spotify") return document.createTextNode(part);
      const span = document.createElement("span");
      span.className = part === "Spotify" ? "brand-spotify" : "brand-apple";
      span.textContent = part;
      return span;
    });
}

/** Replaces the element's content with the text, provider names colored. */
export function setBrandText(node: Element, text: string): void {
  node.replaceChildren(...brandNodes(text));
}
