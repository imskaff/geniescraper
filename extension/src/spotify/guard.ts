// Runs in the page's own world at document_start, in the tabs the worker opens to read credits and nowhere else.
// A signed-in Spotify page registers itself as a Connect device and can start or take over the user's playback;
// reading credits must never do that. The page is not given a way to play: media elements refuse play() and the
// player cannot get a decryption key system, which it needs before it can play protected audio.
import { READ_MARKER } from "./url";

const NOT_ALLOWED = (): DOMException => new DOMException("Playback is off while credits are read.", "NotAllowedError");

/** Take away what a page needs to play audio. Safe to call twice. */
export function blockPlayback(win: Window & typeof globalThis): void {
  const mediaProto = win.HTMLMediaElement.prototype;
  mediaProto.play = () => Promise.reject(NOT_ALLOWED());
  // A page that never calls play() (autoplay attribute, a src set on a playing element) is paused when it starts.
  win.document.addEventListener(
    "play",
    (event) => {
      if (event.target instanceof win.HTMLMediaElement) {
        event.target.muted = true;
        event.target.pause();
      }
    },
    true,
  );
  const nav = win.navigator;
  if (typeof nav.requestMediaKeySystemAccess === "function") {
    nav.requestMediaKeySystemAccess = () => Promise.reject(new DOMException("No key system.", "NotSupportedError"));
  }
}

/** True for the address the worker opens (see `spotifyOpenUrl`), never for a tab the user opened. */
export const isReaderTab = (search: string): boolean => new URLSearchParams(search).has(READ_MARKER);

if (typeof window !== "undefined" && isReaderTab(window.location.search)) blockPlayback(window);
