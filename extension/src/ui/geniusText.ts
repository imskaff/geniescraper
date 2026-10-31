// What the panel says about "Open on Genius", in one place: the live regions announce it and the notice shows it.
import { type GeniusOpenState } from "./panelState";

export interface GeniusMessage {
  text: string;
  /** "problem" needs the user to act and is announced assertively; "info" is progress. */
  tone: "info" | "problem";
}

export function geniusMessage(genius: GeniusOpenState): GeniusMessage | null {
  const name = genius.title ? `“${genius.title}”` : "this song";
  switch (genius.phase) {
    case "idle":
      return null;
    case "working":
      return { tone: "info", text: `Looking for ${name} on Genius…` };
    case "opened":
      return { tone: "info", text: `The edit form for ${name} is open on Genius. Nothing was typed or saved.` };
    case "none":
      return {
        tone: "problem",
        text: `Genius has no song that matches ${name} exactly, so nothing was opened. It may not be on Genius yet.`,
      };
    case "several":
      return {
        tone: "problem",
        text: `Several Genius pages match ${name} exactly, so nothing was opened. Open the right one yourself:`,
      };
    case "sign-in":
      return {
        tone: "problem",
        text: `The page for ${name} opened, but it has no Edit Metadata button. Sign in to Genius there, then press Open on Genius again.`,
      };
    case "no-form":
      return {
        tone: "problem",
        text: `The page for ${name} opened, but its edit form did not. Open it yourself with Edit Metadata on that page, then start pasting.`,
      };
    case "failed":
      return {
        tone: "problem",
        text: `Could not find ${name} on Genius: Genius did not answer or its page did not load. Try again.`,
      };
    case "busy":
      return { tone: "problem", text: "Automatic pasting is running. Pause it, then open the song." };
  }
}
