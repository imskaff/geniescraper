// The YouTube key steps and the key box.
import { el } from "./dom";
import { type PanelState } from "./controller";
import { type ViewContext } from "./viewContext";

export function youtubeKeyContent(v: ViewContext, state: PanelState): Node[] {
  const link = (text: string, href: string): HTMLElement =>
    el("a", {
      class: "button quiet link-button",
      text,
      attrs: { href, target: "_blank", rel: "noopener noreferrer" },
    });
  const step = (title: string, detail: string, action?: HTMLElement, highlight = false): HTMLElement =>
    el(
      "li",
      highlight ? { class: "highlight" } : {},
      el("strong", { text: title }),
      el("span", { class: "step-detail", text: detail }),
      ...(action ? [action] : []),
    );

  const steps = el(
    "ol",
    { class: "how-to" },
    step(
      "Create a project.",
      "Sign in with your Google account when asked. Type any name, for example Geniescraper, then press Create. If Google asks you to accept its terms, tick the box and continue. You should not need to add a payment card; if Google asks for one, skip it.",
      link("Open step 1 in Google", "https://console.cloud.google.com/projectcreate"),
    ),
    step(
      "Switch on the YouTube service.",
      "Check that your new project is named at the top of the page, then press the blue Enable button. Wait until the page changes.",
      link("Open step 2 in Google", "https://console.cloud.google.com/apis/library/youtube.googleapis.com"),
    ),
    step(
      "Create your key.",
      "Press + Create credentials, then choose API key. Under API restrictions choose Restrict key, open the list, and tick only YouTube Data API v3 (it is at the bottom of the list; you can also type YouTube in the list's search box). Press OK, then Create. If you are unsure, choosing Don't restrict key also works. A box then shows your key: a long text that starts with AIza. Press the copy icon next to it.",
      link("Open step 3 in Google", "https://console.cloud.google.com/apis/credentials"),
    ),
    step(
      "Paste it here.",
      "Come back to this panel, click the box below and press Ctrl+V (Cmd+V on a Mac), or press Paste from clipboard. Then press Save and check key. You will see whether Google accepted it.",
    ),
    step(
      "Keep it private.",
      "Never share your key or post it online. If it ever leaks, delete it on Google's Credentials page and create a new one.",
      undefined,
      true,
    ),
  );

  const input = el("input", {
    class: "field",
    attrs: {
      id: "youtube-key",
      "data-key": "youtube-key",
      type: "password",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "AIza…",
      "aria-describedby": "youtube-key-help",
    },
    on: {
      input: (event) => {
        v.keyDraft = (event.target as HTMLInputElement).value;
        // Pressing Save for a key that is already saved and working changes nothing, so it waits for a different one.
        const save = v.root.querySelector<HTMLButtonElement>('[data-key="youtube-key-save"]');
        if (save) save.disabled = v.keyBusy() || v.panel.keyIsCurrent(v.keyDraft);
      },
    },
  });
  input.value = v.keyDraft;
  const show = el("input", {
    attrs: { type: "checkbox", "data-key": "youtube-key-show" },
    on: {
      change: (event) => {
        input.type = (event.target as HTMLInputElement).checked ? "text" : "password";
      },
    },
  });

  const busy = state.youtubeKey.busy;
  const message = state.youtubeKey.message;
  return [
    el("p", {
      class: "help",
      text: "The free YouTube search can be blocked by Google, and then no link is found. For reliable links you can use Google's official YouTube service with your own free key. It is free for roughly 25 songs a day, and the key stays in this browser: it is not synced and it is sent only to Google.",
      attrs: { id: "youtube-key-help" },
    }),
    v.disclosure("youtube-key-steps", "How do I get a key? Step by step (about 3 minutes)", steps),
    el("label", { text: "Your YouTube key", attrs: { for: "youtube-key" } }),
    input,
    el("label", { class: "check" }, show, el("span", { text: "Show the key" })),
    el(
      "div",
      { class: "row" },
      v.button(
        "Save and check key",
        "primary",
        "youtube-key-save",
        () => void v.panel.saveYoutubeKey(input.value),
        busy || v.panel.keyIsCurrent(v.keyDraft),
      ),
      v.button(
        "Paste from clipboard",
        "quiet",
        "youtube-key-paste",
        () => {
          void pasteKey(v, input);
        },
        busy,
      ),
      state.youtubeKey.saved
        ? v.button("Remove my key", "quiet", "youtube-key-remove", () => void v.panel.removeYoutubeKey(), busy)
        : null,
    ),
    el("p", {
      class: "help",
      text: state.youtubeKey.saved ? "A key is saved in this browser." : "No key is saved.",
      attrs: { "data-key": "youtube-key-state" },
    }),
    el(
      "p",
      {
        class: message ? `help key-message ${state.youtubeKey.tone}`.trim() : "help",
        attrs: { id: "youtube-key-message", "aria-live": "polite", "data-tone": state.youtubeKey.tone },
      },
      // The mark is for sighted users; the words carry the meaning for everyone else.
      ...(message && state.youtubeKey.tone
        ? [
            el("span", {
              class: "tone-mark",
              text: state.youtubeKey.tone === "ok" ? "✓ " : "✗ ",
              attrs: { "aria-hidden": "true" },
            }),
          ]
        : []),
      message,
    ),
    el(
      "p",
      { class: "help" },
      link("Google's own guide to API keys", "https://developers.google.com/youtube/v3/getting-started"),
    ),
  ];
}

/** Fill the key box from the clipboard; Chrome may ask first, or refuse, and then typing it in works as well. */
export async function pasteKey(v: ViewContext, input: HTMLInputElement): Promise<void> {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (text) {
      input.value = text;
      v.keyDraft = text;
      input.focus();
      return;
    }
    v.panel.noteKeyMessage("The clipboard is empty. Copy the key from Google's page first.");
  } catch {
    v.panel.noteKeyMessage(
      "Chrome did not let the extension read the clipboard. Click in the box and press Ctrl+V (Cmd+V on a Mac) instead.",
    );
  }
}
