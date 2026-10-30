# Genius navigation, step 1: open the current song on Genius

Status: step 1 (one track at a time).
Step 2 (driving navigation across a whole album) is not part of this design; see the end.

## Goal

Today the user opens each song's Genius page, and its Edit Metadata form, by hand.
Step 1 adds an **Open on Genius** action for the current track in the side panel.
It finds the Genius song that is exactly this track, opens its Edit Metadata form, and leaves the rest to the existing paste flow.
An optional setting does the same when the user starts the next track.

## What was measured (read-only, 30 October 2026)

- **Search.** Genius's own web app searches with `GET https://genius.com/api/search/song?q=<text>`.
  It needs no token and no sign-in, and returns JSON: `response.sections[0].hits[]`, each `{ type: "song", result }`.
  A `result` has `id`, `title`, `path`, `url`, `primary_artists[].name`, `featured_artists[].name` and `lyrics_state`.
  Ten hits come back per page, with `next_page` for more.
- **The worker can ask it.** One `fetch` from the real extension's service worker (scratch profile, no cookies, no referrer, redirects refused, exactly what `lookups/http.ts` does) returned 200 with JSON.
  A plain `curl` gets a 403 from Cloudflare, so this is only known to work from the browser; the search therefore runs in the service worker and nowhere else.
- **Translations are in the results.**
  "Taylor Swift Fortnight" returns the song first, then nine translation and unrelated pages whose titles contain the song name ("Taylor Swift - Fortnight ft. Post Malone (Traducción al Español)").
  Their primary artist is a translation account ("Genius Traducciones al Español"), so an artist check removes them; a title check alone would not.
- **There is no URL for the edit form.**
  The form is a modal (`form[aria-label="Edit Song Metadata Form"]`) opened from the song page by a button whose text is exactly `Edit Metadata`.
  That is the control `scripts/live-genius.mjs` already clicks.
  It only exists when the user is signed in to Genius; signed out (as in the browser pane used for this probe) the song page has no such button.

## Finding the matching song

Pure logic, in `extension/src/core/geniusMatch.ts`, using the helpers in `core/text.ts`.

1. **Query.** `<primary artist> <title without its featured-artist part>`, sent once, page 1 only.
   Only hits with `type === "song"` and a usable `result` are kept.
2. **Title.** The `coreTitleWords` of both titles must be equal, word for word.
   Version words are part of the title: "Song (Remix)", "Song (Live)", "Song (Remastered 2011)" and "Song (Taylor's Version)" do not match "Song".
   `&` and `and` count as the same word.
   Accents and case are folded by `words()`.
3. **Artist.** The Apple Music artist line, as a bag of words, must equal the bag of Genius's primary artists, or of primary plus featured artists.
   Bags (not lists) because Apple writes "A & B", Genius lists A and B separately, and "Tyler, The Creator" must not be split.
   The Apple line is also tried without its own featured-artist tail.
   This is deliberately stricter than `sameTrack` in `lookups/itunes.ts`, which accepts any one shared word; here one wrong song would put credits on the wrong page.
4. **Outcome.**
   - Exactly one hit passes: **match**.
   - None passes: **no match** (not on Genius yet, or the search did not show it).
   - Several different songs pass (for example duplicate pages): **several**.
5. Nothing is ranked or guessed.
   A close match is never taken for an exact one.

The response is untrusted data.
Its `url` is never followed: the page address is built as `https://genius.com` plus `path`, and only when `path` matches `^/[A-Za-z0-9][A-Za-z0-9._~%-]*$`.
A hit with any other path is dropped.

## Reaching the edit form

1. A Genius tab already **at that song's page** is reused: it is brought to the front and nothing is navigated.
2. Otherwise a **new visible tab** opens at the song page.
   An existing Genius tab is never navigated away: it may hold an edit form with unsaved changes, and the extension never saves for the user.
   (The extension's background reads use hidden windows; this one must be visible, so it uses its own port method and not `createTab(url, false)`.)
3. When the tab reports complete, the Genius content script is asked to open the form:
   - if the form is already open, it does nothing;
   - otherwise it waits (bounded) for a `button` whose text is exactly `Edit Metadata`, clicks that one button, and waits (bounded) for the form.
   It never looks for, and never clicks, Save or Cancel, and it never touches the cookie consent dialog.
   If the dialog swallows the click, or the form does not appear, the panel says so and asks the user to open the form themselves.
4. No `Edit Metadata` button means the user is not signed in to Genius: the panel says to sign in there, and stops.

The click happens only for a song the extension found by the exact-match rules above, so it cannot land on another song's form.

## When it cannot continue

Every case stops and tells the user; none continues on its own and none guesses.

| Case | Panel says | Next |
| ---- | ---------- | ---- |
| Genius search unreachable | Genius could not be reached | Try again |
| No match | No exact match for this song on Genius; it may not be on Genius yet | Nothing opened; the user can search Genius themselves |
| Several matches | Several Genius pages look like this song | Each page as a link; the user opens the right one themselves |
| Not signed in | Sign in to Genius, then try again | Try again |
| Form did not open | Open its Edit Metadata form yourself | Start pasting as usual |
| Opened | Opened on Genius | Start pasting |

## Hand-over to the paste flow

Order matters, because a Genius page that loads while an automatic run is running pauses it ("page-changed"):

1. Never navigate while a paste session is active; Open on Genius is not offered then.
2. Search, open or find the tab, wait for the form.
3. Only after the form is confirmed open does the panel start the paste (`paste-start`, then `paste-auto-start` in auto mode), exactly as Start pasting does today.

The manual **Open on Genius** button stops after step 2 and leaves Start pasting to the user.
The setting **Open the song on Genius when I start pasting it** (off by default, under "After a track") runs steps 1 to 3: it hooks `startPaste`, so it covers Paste next track, its countdown and the first Start pasting.
If any state other than "opened" results, the paste does not start.

## Safety rules, restated

- Exact match only; zero or several candidates stop.
- Never Save, never Cancel; the one control clicked is Edit Metadata.
- Auto-paste's own pauses (the user clicking or typing in the form, Esc, closing the panel) are unchanged, because the paste only starts after the form is open.
- No new host and no new permission: `genius.com` is already a required host.
  `genius.com` joins the lookup hosts in `lookups/http.ts` (its fetch rules: no cookies, no referrer, no redirects).
- Privacy: the track title and artist are now sent to genius.com's search, only when the user presses Open on Genius or has the setting on.
  `PRIVACY.md` says so; the store's data-use answers need the same check at submission.

## Panel states (per track)

`idle`, `working` (searching, then finding or opening the form), `opened`, `none`, `several`, `sign-in`, `no-form`, `failed` and `busy` (a paste is running).
The state belongs to one track; the notice shows only while that track is on screen, and starting a paste or leaving the album clears it.
The UI is its own set of modules: `ui/geniusOpener.ts` (behaviour), `ui/geniusText.ts` (the words) and `ui/geniusView.ts` (button and notice), the way `updateNotice.ts` and `updateBanner.ts` are split; the controller and the review and finished screens get one hook each.

## Not in step 1 (what step 2 needs)

- Opening the next song's page by itself after a finished paste, and then the one after, across the whole album.
- A decision about the tab: reusing one tab for the whole album means navigating away from a form the user has not yet saved.
  That needs either a "saved" signal (Genius's own state after Save, which the extension does not touch) or an explicit confirmation from the user per song.
- Search page 2 when page 1 holds only translations for very common titles.
- Genius albums pages, to match a whole album's songs in one request.
