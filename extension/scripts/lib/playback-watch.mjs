// Watches every open.spotify.com page of a running browser for playback: an audio or video element that is not
// paused, a media session that says "playing", or a play() call made while the watcher was attached. A read of
// credits must never start playback in any tab, so the live Spotify checks assert `report().playing === 0`.
import { connect, sleep } from "./cdp.mjs";

const PROBE = `(() => {
  if (!window.__geniePlays) {
    window.__geniePlays = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__geniePlays += 1; return play.apply(this, arguments); };
  }
  return {
    playing: [...document.querySelectorAll('audio, video')].filter((m) => !m.paused && !m.ended).length,
    session: navigator.mediaSession ? navigator.mediaSession.playbackState : 'none',
    plays: window.__geniePlays,
    title: document.title,
  };
})()`;

/** Start polling; `stop()` ends it and `report()` says what was seen. */
export function watchPlayback(browser, { everyMs = 150 } = {}) {
  const sessions = new Map();
  const seen = { pages: 0, playing: 0, sessionPlaying: 0, playCalls: 0, samples: [] };
  let running = true;
  const loop = (async () => {
    while (running) {
      const targets = (await browser.targets()).filter((t) => t.type === "page" && /open\.spotify\.com/.test(t.url));
      for (const target of targets) {
        try {
          if (!sessions.has(target.id)) {
            sessions.set(
              target.id,
              await Promise.race([
                connect(target.webSocketDebuggerUrl),
                sleep(2000).then(() => {
                  throw new Error("no answer");
                }),
              ]),
            );
            seen.pages += 1;
          }
          // A page that closed mid-call never answers, so every call is cut off after two seconds.
          const state = await Promise.race([
            sessions.get(target.id).evaluate(PROBE),
            sleep(2000).then(() => {
              throw new Error("no answer");
            }),
          ]);
          if (state.playing > 0) seen.playing += 1;
          if (state.session === "playing") seen.sessionPlaying += 1;
          seen.playCalls = Math.max(seen.playCalls, state.plays);
          if ((state.playing > 0 || state.session === "playing" || state.plays > 0) && seen.samples.length < 5) {
            seen.samples.push({ url: target.url, ...state });
          }
        } catch {
          sessions.delete(target.id);
        }
      }
      await sleep(everyMs);
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      for (const session of sessions.values()) session.close();
    },
    report: () => ({ ...seen }),
  };
}
