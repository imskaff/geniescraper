// Settings for the link to the desktop app.
import { el } from "./dom";
import { type PanelState } from "./controller";
import { type ViewContext } from "./viewContext";
import { settingsCard, subgroup } from "./settingsParts";

/**
 * The optional YouTube key, with everything a first-time user needs on the page: what it is for, every step to get
 * one with a link to the exact Google page for each, and a way to paste and check it. The links open Google's own
 * pages in a new tab; the extension never reads those pages, so nothing here needs another permission.
 */
/** The link to the desktop app: what pairing does, how it stands now, and the code box. */
export function desktopSettings(v: ViewContext, state: PanelState): HTMLElement {
  const { bridge } = state;
  const statusText = !bridge.known
    ? "Checking the link to the desktop app…"
    : !bridge.paired
      ? "Not paired. No desktop app is linked to this browser."
      : bridge.connected
        ? "Paired and connected to the desktop app."
        : "Paired, desktop app not running. Open the desktop app and this panel reconnects by itself.";
  const pair = (): void => {
    const input = v.root.querySelector<HTMLInputElement>("#bridge-code");
    const typed = input ? input.value : v.codeDraft;
    void v.panel.pairBridge(typed).then(() => {
      // A code that worked is spent; one that did not stays, so a typo can be fixed rather than retyped.
      if (v.panel.state.bridge.tone === "ok") v.codeDraft = "";
      v.render();
    });
  };
  const input = el("input", {
    class: "field",
    attrs: {
      id: "bridge-code",
      type: "text",
      "data-key": "bridge-code",
      autocomplete: "off",
      autocapitalize: "characters",
      spellcheck: "false",
      maxlength: "16",
      placeholder: "ABCD-EFGH",
      "aria-describedby": bridge.message ? "bridge-code-help bridge-message" : "bridge-code-help",
      ...(bridge.tone === "error" ? { "aria-invalid": "true" } : {}),
    },
    on: {
      input: (event) => {
        v.codeDraft = (event.target as HTMLInputElement).value;
      },
      keydown: (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          pair();
        }
      },
    },
  });
  input.value = v.codeDraft;
  // Paste sits inside the right end of the box; Chrome may ask before the extension reads the clipboard, or refuse.
  const pasteCode = async (): Promise<void> => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        input.value = text;
        v.codeDraft = text;
        input.focus();
        return;
      }
      v.panel.noteBridgeMessage("The clipboard is empty. Copy the code from the desktop app first.");
    } catch {
      v.panel.noteBridgeMessage(
        "Chrome did not let the extension read the clipboard. Click in the box and press Ctrl+V (Cmd+V on a Mac) instead.",
      );
    }
  };
  const message = el(
    "p",
    {
      class: bridge.message ? `help key-message ${bridge.tone}`.trim() : "help",
      attrs: {
        id: "bridge-message",
        "aria-live": bridge.tone === "error" ? "assertive" : "polite",
        "data-tone": bridge.tone,
      },
    },
    ...(bridge.message && bridge.tone
      ? [
          el("span", {
            class: "tone-mark",
            text: bridge.tone === "ok" ? "✓ " : "✗ ",
            attrs: { "aria-hidden": "true" },
          }),
        ]
      : []),
    bridge.message,
  );
  return settingsCard(
    "settings-desktop",
    "Desktop app",
    el("label", { text: "Pairing code", attrs: { for: "bridge-code" } }),
    el(
      "div",
      { class: "field-action" },
      input,
      v.button("Paste", "quiet", "bridge-paste", () => void pasteCode(), bridge.busy),
    ),
    el(
      "div",
      { class: "row" },
      v.button("Pair", "primary", "bridge-pair", pair, bridge.busy),
      bridge.paired
        ? v.button(
            "Unpair",
            "quiet",
            "bridge-unpair",
            () => {
              void v.panel.unpairBridge().then(() => {
                v.root.querySelector<HTMLElement>("#bridge-code")?.focus();
              });
            },
            bridge.busy,
          )
        : null,
    ),
    el("p", { class: "help", text: statusText, attrs: { id: "bridge-status", "aria-live": "polite" } }),
    message,
    subgroup(
      "What is this?",
      el(
        "div",
        { class: "stack", attrs: { id: "bridge-help" } },
        el("p", {
          text: "The Géniescraper desktop app is this extension's companion on your computer, and pairing links the two. Once paired, the app lists the Apple Music pages you have open and this extension fills the Genius form for you, one step at a time or all at once.",
        }),
        el(
          "ul",
          { class: "plain-list" },
          el("li", {
            text: "To pair, open the desktop app, choose Connect browser extension and type its code above (capitals, dashes and spaces do not matter).",
            attrs: { id: "bridge-code-help" },
          }),
          el("li", { text: "The link stays on this computer (127.0.0.1) and never goes over the internet." }),
          el("li", {
            text: "Your Genius password is never shared: you stay signed in in this browser, and the app never sees it.",
          }),
          el("li", { text: "Unpair at any time to cut the link." }),
        ),
      ),
    ),
  );
}
