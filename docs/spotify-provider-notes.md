# Spotify provider notes

Hand-over notes for building the Spotify credits provider.
They close the open points of `docs/research-services.md` section 12 and describe the reference reader in `extension/scripts/lib/spotify-read.mjs`, which the provider's logic should be ported from.

Everything here was measured on 2026-10-31 against `open.spotify.com`, signed out, no credentials, one page at a time with 4 to 5 second pauses, one window in a throwaway profile, no captcha, block or 429 at any point.
Volume: about 55 page loads in a real Chrome (plus 3 plain GETs of one track page), inside the agreed budget of about 60.
Raw run files are kept outside the repository.

## Result in short

| Question | Answer |
|---|---|
| Does the isolated world (a content script injected by `chrome.scripting.executeScript`) open the dialog in a background tab? | **Yes.** About 35 background-tab loads of valid pages (`visibilityState` "hidden"), over 12 tracks, 4 UI languages and 4 album pages (up to 14 tracks one after another): all opened and parsed, except one cold first load where the click on the entry opened nothing (fixed by the built-in retry). |
| Minimised window? | **Yes, 4 of 4.** The page reported "visible" there (Chrome did not treat the extension-created minimised window as hidden), so this is not a stronger test than the background tab. |
| Off-screen window? | **Not possible from an extension**: `chrome.windows.create` rejects bounds that are not at least 50 percent on screen. Earlier CDP-created off-screen windows worked with `click()` in the main world (8 of 8), but an extension cannot make one. Not needed. |
| Tracks from an album page? | **Yes**, same click path, no extra page load per track: 14 of 14 on one album in 29.6 s (about 1 s per track plus a 0.4 s pause I added), hidden tab. |
| Long albums? | A windowed list: only the first ~25 rows exist until scrolled. Scrolling works in a **visible** tab (100 of 100 rows, 5 scrolls, 14 s) and **does not** in a hidden one (stayed at 25). Use track pages, or the album's printed track count to detect the gap. |
| Other languages? | Structure is identical in 4 of 4 languages (pl, de, ja, en). Text is localized, including the dialog heading, section headings and most role names. A tab-scoped `Accept-Language` rule forces English reliably (2 of 2, German browser). |
| No credits vs failed to open? | The dialog always has at least the Artist section. A track with "no credits" still opens and parses (2 of 2 rain tracks: Artist section plus Source only). A failed open has a distinct `status` (see failure modes). |
| Release date, label, ISRC, cover | See "Metadata". Full release date is **not** on a hydrated track page; ISRC is nowhere (0 of 7). |

## Permissions needed (exact)

Manifest of the throwaway test extension that produced the numbers above:

```json
{
  "permissions": ["scripting"],
  "host_permissions": ["https://open.spotify.com/*"]
}
```

- `scripting` plus the host permission is enough to inject the reader (`chrome.scripting.executeScript({ files })`) into the tab the extension opened.
- No `tabs` permission was needed: `chrome.tabs.create`, `get`, `update`, `sendMessage` and `chrome.windows.create`/`get`/`remove` all worked with only the host permission.
- No `debugger`, `webRequest`, `activeTab`, `storage` or content script declaration.
- To force English (recommended, see Languages) add `"declarativeNetRequest"`; the rule is a session rule limited to the probe's tab, and it also needs the host permission already listed.
- If the project keeps host permissions optional, `open.spotify.com` has to be granted before the first read.

## Read procedure, step by step

Written for a hidden tab; this is what `readCredits` does.

1. Open `https://open.spotify.com/track/<id>` in a tab with `active: false`.
   If English is wanted, create the tab on `about:blank`, add the session rule (below), then `chrome.tabs.update(tabId, { url })`.
   Page load to `status: complete` took 1.0 to 1.6 s.
2. Inject the reader once with `chrome.scripting.executeScript({ target: { tabId }, files: [...] })` and ask it to run (`chrome.tabs.sendMessage`).
3. Wait for the options button: `[data-testid="action-bar-row"] button[data-testid="more-button"]` (fallback `main button[data-testid="more-button"]`).
   Appears 0.0 to 0.6 s after injection.
   Do not use the `aria-label`, it is localized ("More options for X", "Mehr Optionen für X", "Więcej opcji dla: X").
4. `button.click()`; wait for `[role="menu"] [role="menuitem"]`.
5. Pick the credits entry by structure (see Selectors), `click()` it.
6. Wait for `dialog[open][aria-label]` containing `[role="group"]` rows or an `h1`.
   If nothing appears within 5 s, close the menu (click the options button again, it toggles) and retry once from step 4.
   This happened once in about 35 loads (first load of a fresh profile, 5.7 s wait, then nothing); the retry is cheap insurance, and the tests cover it. The cause is unknown (a handler not yet attached right after hydration is the likely one).
7. Parse the dialog (see Selectors), then close it with its `button[aria-label]` close button or leave the tab to be closed.
8. Close the tab (and the helper window, if one was created).

Timing in a hidden tab with the mutation-observer wait: button 0 to 0.6 s, menu +0.02 s, dialog +0.1 to 0.2 s, parsed +0.15 s; about 1.5 s of script time per track and 2.0 to 2.7 s per load including the navigation.
With a plain 100 ms `setTimeout` poll the same read took 3 to 5 s, because a hidden tab throttles timers to about one a second.
`until()` in the reader therefore re-checks on every DOM mutation as well as on a timer.

`click()` is enough in every world and every state that was tried.
Synthetic keyboard events do nothing (0 of 10, earlier run), so do not bother with keys.

### Forcing English

Spotify localizes on the server from the `Accept-Language` request header of the page load.
These did **not** work: the `/intl-en/` URL prefix (the page redirects and stays in the browser language, measured again 2026-11-01 in German, Polish and Japanese: see below), and overriding `navigator.language` in the page.
This worked (2 of 2, Chrome set to German, page came back with `lang="en"`, heading "Credits", English sections and roles):

```js
await chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [1],
  addRules: [{
    id: 1, priority: 1,
    action: { type: "modifyHeaders", requestHeaders: [{ header: "Accept-Language", operation: "set", value: "en-US,en;q=0.9" }] },
    condition: { requestDomains: ["open.spotify.com"], tabIds: [tab.id],
                 resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "script", "other"] },
  }],
});
```

Two traps: `main_frame` must be listed explicitly (it is excluded by default for `modifyHeaders`), and the rule must be limited to the probe's `tabIds` so the user's own Spotify tabs keep their language.
Remove the rule when the job ends.

### English by address: measured again on 2026-11-01, does not work

Re-measured before building anything, in a throwaway Chrome profile per run (`--lang` and `--accept-lang` set), signed out, 11 page loads in all, one at a time, no captcha or 429.

| Run | Address asked for | Address after load | `lang` | Dialog heading | Read time |
|---|---|---|---|---|---|
| de-DE | `/track/<id>` | `/intl-de/track/<id>` | de | Songinfos | 2845 ms |
| de-DE | `/intl-en/track/<id>` | `/intl-de/track/<id>` | de | Songinfos | 2717 ms |
| pl-PL | `/intl-en/track/<id>` | `/track/<id>` | pl | Autorzy treści | 2410 ms |
| ja-JP | `/intl-en/track/<id>` | `/intl-ja/track/<id>` | ja | 楽曲クレジット | 2702 ms |
| de-DE | `/intl-en/album/<album id>` and the plain album address | `/intl-de/album/<id>` | de | not read (the album id used had no track rows, so only the redirect is a result) | 16.7 s both (waiting for rows that never came) |

- The `/intl-en/` prefix is dropped by a redirect to the address of the browser language in every case (4 of 4), so the page, its dialog and its role names stay in that language.
  The click path was untouched, and the read was not slower, but it also did not help.
- `/intl-en/` is not a spelling the web player writes.
  What the player does when its language picker is used (button `[data-testid="language-selection-button"]`, then `[data-testid="language-option-en"]`, a button and not a link) was watched in a throwaway profile: it sets the cookie **`sp_locale=en`** and reloads the page on the **unprefixed** address.
  There is no `sp_locale` cookie before that, and no other cookie or address changes; English has no prefix, other languages get `/intl-xx/`.
- Setting `document.cookie = "sp_locale=en; path=/"` from the page (no permission needed, the cookie is not `HttpOnly`) and loading the plain address gave `lang="en"` (1 of 1).
  This is not usable as the reader's way: the cookie belongs to the whole `open.spotify.com` origin, so the user's own Spotify tabs would switch language on their next load, and an `sp_locale` the user already chose would have to be saved and restored (even a crash between set and restore leaves their player in English).
  It would also be the extension writing to the user's browsing state, which the project avoids.

Nothing was built from this: the English address is not an option. The later section "Other ways to English roles" found `?locale=en`, which does work and supersedes the recommendation below.

#### Option on paper: tab-scoped `Accept-Language` rule (the recipe above)

- Needs `declarativeNetRequestWithHostAccess` (a `modifyHeaders` rule on a site needs the host permission, which the extension already has for `open.spotify.com`).
  Plain `declarativeNetRequest` also works but is the wider permission (its install prompt line is, to the best of my knowledge, "Block content on any page"); the `WithHostAccess` variant is, to the best of my knowledge, listed without any line of its own in Chrome's prompt, so it adds nothing a reader would see.
  Both statements come from memory of Chrome's documentation and were **not** verified in this session.
- It can probably be an optional permission (`optional_permissions`) and be requested from a click when a read is about to happen in a language without an alias table; not verified.
  A request from a click shows Chrome's own small "allow" dialog naming the permission.
- The rule is a session rule limited to the reader's `tabId`, removed when the job ends: the user's own tabs are not affected, no cookie is written.
  Cost: the tab has to be created on `about:blank`, the rule added, then navigated (one extra call, a few ms); the 2 of 2 earlier forced-English reads had normal timings.
- Safari: the API exists in Safari's web extensions, but support for `modifyHeaders` with `tabIds` there was not checked.

Recommendation: keep the alias tables for the 12 languages they cover and add the tab-scoped rule as an optional permission, asked for only on the first read in a language the tables do not cover (or when the fallback was used), so no user sees a new permission unless they would otherwise lose roles.
The cookie route is the only permission-free way to English and is rejected for the reasons above.

## Other ways to English roles: research of 2026-11-01

Everything below was measured on 2026-11-01 against `open.spotify.com`, signed out, no credentials, one page at a time with 4 to 5 second pauses, a throwaway Chrome profile per run (never the user's own), no captcha, block or 429.
Volume: about 38 page loads for this section (plus 4 plain GETs and 27 iTunes searches), inside the budget of 45.
The probe `extension/scripts/live-spotify-probe.mjs` gained `--query "?locale=en"` for this.

### Result in short

**The query string `?locale=en` gives the whole page, the credits dialog and all role names in English, for one request only, with no permission and no cookie.**
It worked in 12 of 12 track reads and 2 of 2 album reads (German, Polish, Japanese, Arabic and Thai browsers).
The earlier conclusion that only a header rule can force English was wrong because `?locale=` had not been tried; `/intl-en/` (above) is still a dead end.

### 3. Query-string switches (the winner)

Chrome with `--lang` and `--accept-lang` de-DE, same track (`/track/<id>` plus the query), final address and `lang` after the page settled:

| Query | Final address | `lang` | Result |
|---|---|---|---|
| `?locale=en` | `/track/<id>?locale=en` | en | **English** ("Your Library"), no redirect to `/intl-de/` |
| `?go=1&locale=en` | `/track/<id>?go=1&locale=en&nd=1&dlsi=...` | en | English (the page added its own parameters) |
| `?l=en` | `/intl-de/track/<id>?l=en` | de | no effect |
| `?language=en` | `/intl-de/track/<id>?language=en` | de | no effect |

Credits dialog with `?locale=en`, track "Blinding Lights", read by the real reader in a hidden tab:

| Browser language | Final address | `lang` | Heading | Sections | Roles | Read time |
|---|---|---|---|---|---|---|
| de-DE | `/track/<id>` | en | Credits | Artist, Composition & Lyrics, Production & Engineering, Performers | all 14 English (Main Artist, Composer, Lyricist, Producer, Mixing Engineer, Mastering Engineer, Recording Second Engineer, Engineer, Bass Vocalist, Programmer, Drum Kit, Guitar, Keyboard, Background Vocalist) | 2304 ms |
| pl-PL | same | en | Credits | same | same 14 | 2703 ms |
| ja-JP | same | en | Credits | same | same 14 | 2760 ms |
| ar-SA | same | en | Credits | same | same 14 | 2724 ms |
| th-TH | same | en | Credits | same | same 14 | 2711 ms |

More reads with the query, Japanese browser, three other tracks: all `ok`, English heading and sections, 13, 13 and 16 rows, 1986 to 2578 ms.
`/intl-de/track/<id>?locale=en` (an address that already carries a locale prefix) also came back English at `/track/<id>` (1 of 1).
Albums with the query (German browser, one visible-window run and one hidden-tab run): `lang` en, 14 rows found, the first three tracks opened their English dialogs in about 1.0 s each, and the album page printed its date in English ("March 20, 2020"), which would also make a full release date parseable.
Speed: the plain German read took 2845 ms against 2304 to 2760 ms with the query, so no slowdown.

- **No cookie is written.**
  After the `?locale=en` load the profile had no `sp_locale` cookie, and a plain load in the same profile came back German (`/intl-de/...`).
  The language applies to that one request, so the user's own Spotify tabs and settings are never touched.
  This also answers the "isolated context" question: none is needed.
- The page stays on the unprefixed address and does not bounce to `/intl-xx/`.
- **Not tested:** a signed-in profile (the hidden tab shares the browser's cookies, so a logged-in user's account language might win; the detection rule below catches that), a Safari run, and whether Spotify keeps the parameter.
  It is an undocumented parameter that the web player evidently supports (the language picker uses the `sp_locale` cookie, the parameter looks like its one-shot form), so treat it as something that can disappear.

How the reader should use it:

1. Open the track or album address with `?locale=en` appended (the read has no use for other parameters, so replacing the query with this one is simplest).
2. Check that the dialog really is English: heading "Credits" or every role found in the English alias table.
   Keep the per-language alias tables as the fallback for any dialog that comes back localised, and name a language in "About this read" only then.
3. No new permission, no change to the manifest.

### 2. `navigator.language` override at `document_start`

Overriding `navigator.language` and `navigator.languages` to `en-US` before any page script ran (done with `Page.addScriptToEvaluateOnNewDocument`, which is what a `registerContentScripts` main-world script at `document_start` does): the page still redirected to `/intl-de/track/<id>`, `lang="de"`, `h1` "Bibliothek" (1 of 1, German).
The server decides the language from the request headers and address before any page script runs, so this cannot work.

### 1. Language-independent structure of the dialog

Read live in English, German, Polish, Japanese, Arabic and Thai ("Blinding Lights"), then 3 German and 8 Japanese reads of other tracks, including small and self-released artists:

- The structure is identical in every language: the same `dialog[open]`, rows, artist ids and Sources row.
  The dialog has **no data attribute, id, aria value or icon that names a section**: a section is a bare `div` whose first child is a heading `span`, and a role is a bare `span` inside `p[id^="listrow-subtitle"]`.
  The only language-free signals are the section's position and the Artist rows' `spotify:artist:` ids.
- Section order is fixed: Artist, Composition & Lyrics, Production & Engineering, Performers, Other Roles (the fifth appeared in 1 of 8 Japanese reads).
  Position is only trustworthy when no section is skipped: in all 19 non-empty reads (6 languages, 14 different tracks) the first four sections were present, so position 1 was always Composition & Lyrics and 2 always Production & Engineering.
  A skipped section would shift every later index, and nothing in the markup would reveal it.
  One of the 8 Japanese reads (`no-credits`) returned a dialog with no rows at all, not even an Artist row.
- Coverage by position alone, on "Blinding Lights" (23 rows): section 1 is Composer and Lyricist, 5 of 5 rows, which is all of Genius's "Written By".
  Section 2 mixes Producer (3 rows) with Mixing, Mastering, Second Engineer and Engineer (7 rows), so **"Produced By" cannot be told from the engineers by position**.
  Section 3 holds the instruments and vocals.
- So structure alone could fill Written By in every language but not Produced By or any finer role.
  With `?locale=en` working it is not needed; it remains a possible defence for the fallback only.

### 4. Direct `fetch` from the worker

- A plain GET of the track page with a Chrome user agent and `Accept-Language: en-US` (and `?locale=en`) returned the 167 KB app shell, `lang="en"`, with no credits word in it (0 of 1).
  The credits are not in the server markup or embedded state, as the earlier fetch test already found.
- The page gets its data from `api-partner.spotify.com/pathfinder/v2/query` (a GraphQL endpoint) with a token from `open.spotify.com/api/token` and a client token from `clienttoken.spotify.com`; the other fetch and XHR requests were telemetry, consent and remote-config calls.
  I did not call it and did not capture the credits query itself (the menu click in that run opened nothing, so the credits request is inferred, not seen).
  It is token-gated and undocumented: do not use it.

### 5. Other public surfaces

| Surface | Result |
|---|---|
| `/embed/track/<id>` (GET, 10.5 KB) | JSON in `__NEXT_DATA__`: title, artists (names and ids), `releaseDate.isoString` (`2020-03-20T00:00:00Z`), duration, cover and preview data. **No credits, no roles.** It does give the **full release date** that the hydrated track page lacks (see Metadata), independent of language. |
| `/oembed?url=...` | Only an iframe snippet, title and thumbnail. No credits. |
| Album per-track menus | The same dialog as the track page and the same language, so `?locale=en` on the album address gives English there too (above). |

The embed's release date is worth a separate look (one extra plain GET per track, no cookie, same host).

### 6. Cross-match to Apple Music

Sample: the 27 rows of the signed-out playlist page "Indie's Top 50" (small and mid-sized artists, new releases, a few self-released), searched on the iTunes Search API (`entity=song`, US store, top 10, 1.5 s between requests); a match is the same title (normalised, brackets and "- suffix" removed) and an artist name containing or contained in a Spotify artist.

- **23 of 27 found (85 percent).**
  The 4 misses: two had 0 results ("Champagne" by Remi Wolf and "the cops are coming" by Junior Mesa, which is suspicious for known artists and may be a search quirk), one had 4 results without a match ("Power", Sophia Stel) and one had 2 ("STORM II", GENER8ION and Yung Lean).
- Not measured: whether the matches are the same recording or edition, and whether Apple's credits for them are as complete as Spotify's.
  Reading Apple credits for the sample would load Apple Music pages beyond this task's approval.
- Judgement: Apple's English credits would be a good second source where the song exists, but the extra search, the mismatch risk (remixes, deluxe editions) and the conflict rules make it a larger feature for little gain once `?locale=en` works.

### 7. Other findings

- A German album page loaded without the query produced `rowCount` 0 in two hidden-tab runs (`/intl-de/album/...`, header and date present, 14 expected, no `tracklist-row` found), while the same album with `?locale=en` found 14 rows both times.
  The cause is unknown (cold-profile timing or different row markup in the German page); worth a look when the provider reads albums in non-English browsers.
- The Japanese `no-credits` read (a dialog without any row) is a case the earlier notes did not have; it showed once in 8.

### Options

| Option | Fixes | Permission | Reliability (measured) | Effort | Risk |
|---|---|---|---|---|---|
| `?locale=en` on the address | all roles, all languages, tracks and albums | none | 14 of 14 reads English | small: address builder, English check, tests, docs | undocumented parameter may change; signed-in accounts untested; the English check plus the tables as fallback cover both |
| Tab-scoped `Accept-Language` rule (declarativeNetRequest) | all roles | optional `declarativeNetRequestWithHostAccess` | 2 of 2 earlier | medium | extra permission and prompt |
| `/intl-en/` prefix | nothing | none | 0 of 4 | none | dead end |
| `navigator.language` override | nothing | `scripting` (have) | 0 of 1 | none | dead end |
| `sp_locale` cookie | all roles | none (page cookie) | 1 of 1 | small | shared with the user's own tabs: rejected |
| Section position | Written By only | none | 19 of 19 reads had all four sections | small | a skipped section shifts the index; Produced By not separable |
| Direct fetch | nothing | host (have) | 0 of 1 | none | credits are not in the page |
| Pathfinder API | roles | tokens | not tried | large | token-gated and undocumented: do not use |
| Embed page | full release date only | host (have) | 1 of 1 | small | a separate feature |
| Apple cross-match | roles where Apple has the song | none new | 23 of 27 found | large | match errors, conflicting credits |

**Recommendation:** build `?locale=en` into the Spotify reader (open the English-query address of the same track or album in the hidden tab), keep the alias tables as the fallback when the dialog does not come back in English (detected by the heading or a known English role set), and name a language in "About this read" only when the fallback was used.
Do not add the declarativeNetRequest permission unless a later check shows that signed-in accounts ignore the parameter or Spotify removes it; keep that option written down.
Consider the embed page as a separate step for the full release date.

## Selectors

Nothing relies on hashed class names.

| Thing | Selector | Language independent |
|---|---|---|
| Options button (track page) | `[data-testid="action-bar-row"] button[data-testid="more-button"]` | yes |
| Options button (album row) | `[data-testid="tracklist-row"] button[data-testid="more-button"]` | yes |
| Menu entries | `[role="menu"] [role="menuitem"]` | yes |
| **Credits entry** | the `button[role=menuitem]` that has neither `aria-disabled` nor `aria-expanded` **and is followed by an entry with `aria-expanded`** ("Share") | yes, found by this rule on every load made after the rule was added (pl, de, ja, en, album rows) |
| Dialog | `dialog[open][aria-label]` (native `<dialog>`; `[role="dialog"]` is the language picker, country picker and consent banner) | yes |
| Dialog title / track | `h1` / `h2` | structure yes, `h1` text localized |
| Section | a `div` whose first child is a heading `span`, followed by its rows | structure yes, heading text localized |
| Row | `[role="group"][aria-labelledby]` with `span[dir="auto"]` (name) and `[id^="listrow-subtitle-"]` (roles) | yes |
| Artist row | `aria-labelledby` contains `spotify:artist:<id>` | yes |
| Source | the one `[role="group"]` row without `span[dir="auto"]`; its last `span` is the value | yes |
| Track page header | `[data-testid="entityTitle"]`, `[data-testid="creator-link"]`, `[data-testid="release-date"]` (year only), `[data-testid="entity-header"] img` | yes |
| Album track rows | `[data-testid="tracklist-row"]` with `a[data-testid="internal-track-link"][href^="/track/"]` and a number in `[aria-colindex="1"]` | yes |
| Copyright | `main p` starting with "℗" or "©", excluding `[data-testid="footer-div"]` (the footer says "© 2026 Spotify AB") | yes (symbols) |

Why the credits entry is found the way it is:

- The menu has 8 entries on a track page: Add to playlist, Save to Liked Songs, Go to song radio, Go to artist, Go to album, **View credits**, Share, Open in Desktop app.
  On an album page's per-track menu "Go to album" is missing, so "the entry after Go to album" does not work there.
- Two buttons carry neither `aria-disabled` nor `aria-expanded`: View credits and Open in Desktop app.
  "First such button" alone would pick **Open in Desktop app** on a menu without credits, which tries to launch another program.
  Requiring that the next entry has `aria-expanded` (Share) rules that out; a unit test pins it.
- The English text fallback (`/credit|autor|crédit|mitwirk|クレジット/`) exists but was never needed live.

Parse result per row: `{ section, sectionIndex, name, roles[], artistId }`, plus `source`, `heading`, `title`, `sections[]`.
Several roles of one person are joined with " • " in one string and split by the reader.

### Section headings and roles in English

Sections seen: `Artist`, `Composition & Lyrics`, `Production & Engineering`, `Performers`, `Other Roles`.
A section is absent when empty (the rain tracks only had `Artist`).

Role names seen in English (count of rows in the sample), by section:

- Artist: Main Artist.
- Composition & Lyrics: Composer, Lyricist, Arranger, Recording Arranger, Author.
- Production & Engineering: Producer, Engineer, Recording Engineer, Recording Second Engineer, Mixing Engineer, Mixer, Mastering Engineer, Masterer.
- Performers: Vocalist, Vocals, Background Vocalist, Bass Vocalist, Choir, Guitar, Electric Guitar, Bass Guitar, Drum Kit, Piano, Percussion, Synthesizer, Strings, Violin, Viola, Cello, Trumpet, Trombone, Tuba.
- Other Roles: Director.

New compared with section 12: Arranger, Recording Arranger, Author, Masterer, Choir, Strings, Violin, Viola, Cello, Trumpet, Trombone, Tuba, Director and the whole "Other Roles" section.
The provider needs a lowercase alias table for these (section 12 has the mapping to Genius names); unmapped roles should be kept as written rather than dropped.

## Languages

Same two tracks in each language, plus Polish (the machine's own language) on the earlier loads.

| Language | Dialog heading | Section headings | Credits menu entry | Role names |
|---|---|---|---|---|
| en | Credits | Artist, Composition & Lyrics, Production & Engineering, Performers | View credits | English |
| de | Songinfos | Künstler*in, Komposition und Songtexte, Produktion & Engineering, Interpret*innen | Mitwirkende anzeigen | mostly translated and gendered (Komponist*in, Texter*in, Produzent*in), some stay English (Recording Engineer, Mixing Engineer, Mastering Engineer, Engineer) |
| ja | 楽曲クレジット | アーティスト, 作曲＆歌詞, 制作＆エンジニアリング, パフォーマー | 楽曲クレジットを表示 | translated (作曲家, 作詞家, プロデューサー), some mixed |
| pl | Autorzy treści | Wykonawca, Kompozycja i tekst, Produkcja i inżynieria, Wykonawcy | Pokaż autorów | translated (Kompozytor, Producent, Mikser) |

What stays the same in all four: the menu has the same 8 entries in the same order, the credits entry is at index 5 (index 4 on an album row), every `data-testid`, the native `<dialog>`, the row markup, artist ids in `aria-labelledby`, and the single Sources row.
What changes: every visible string, including the options button's `aria-label`, the date format on album pages, and the role names.

How a reader should cope:

1. Find and open everything by structure (above); that is language independent and verified.
2. Identify the Artist section by `artistId`, not by its heading.
3. Read roles and section headings in **English** by forcing `Accept-Language` for the tab; do not build per-language role tables unless forcing is unacceptable.
4. Keep `sectionIndex` as a language-independent fallback, but do not rely on it alone: sections are omitted when empty, so index 1 is not always Composition & Lyrics.
5. If a role is not in the English alias table, keep it as written and let the user decide.

## Albums

- The album page lists tracks in `[data-testid="tracklist-row"]`; each has the track id in its link (`/track/<id>`), the number, and its own options button.
- That button opens the same menu (without "Go to album") and the same dialog; 14 of 14 tracks of one album read correctly in a hidden tab, `h2` of each dialog matched the row title.
  The menu from a previous track must be closed before the next click, otherwise menus stack up (seen: a second menu appeared with the first still present); the reader closes it by clicking the button again.
- The header prints the track count ("2010 • 100 songs, about 6 hr 30 min"); the reader takes the integer after the year.
  A hidden tab showed 25 of 100 rows after settling and scrolling did not add any, so compare the rows found with that count.
- In a visible tab, scrolling the last row into view 5 times revealed all 100 (rows are recycled, so collect ids as you go; the reader's `readAlbumTracks` does).
- Recommendation: use the album page for the track list and per-track ids only, and read credits from track pages.
  The album route is a convenience for short albums (about 1 s per track); it cannot be trusted for long ones in a hidden tab, and a track page load costs only about 2 s.
- Timing: one album of 14 tracks, whole album 29.6 s including pauses, one page load.

## Failure modes and how to detect each

`readCredits` returns one of these and never throws for page problems.

| `status` | Meaning | How it shows | What the provider should do |
|---|---|---|---|
| `ok` | Dialog opened, has rows | rows parsed | use it; if every row is in the Artist section there are **no credits** beyond the artists (2 of 2 rain tracks) |
| `no-credits` | Dialog opened with no rows at all | not seen live | treat like "no credits" |
| `no-button` | No options button within the wait | seen on an invalid id (`/track/1111111111111111111111`): page title "Spotify – Web Player", no `[data-testid="track-page"]`, 11 s | report "track not found or unavailable"; do not retry |
| `no-menu` | Button clicked, no menu | not seen live | retry once, then fail |
| `no-item` | Menu opened but no credits entry | not seen live (unit-tested) | fail with the menu texts for diagnosis; never click another entry |
| `no-dialog` | Entry clicked, no dialog | seen **once in about 60 loads**, first load of a cold profile, 5.7 s | the built-in retry fixes it; a second failure should be reported |
| `blocked` | Captcha or rate-limit text in the page | never seen | stop the whole run |

- "No credits" versus "failed to open": the first is `ok` with only artist rows (and possibly a Source), the second is any other status.
  A track with absolutely no dialog content was not found among the 13 tracks read.
- Tab closed or navigated away: `chrome.tabs.sendMessage` rejects; treat it as a failure of that read.
- The page is signed out only: a signed-in user's tab is never touched because the provider opens its own tab.
- A region-restricted track was **not** found (see Unknown); an invalid id gives `no-button`.

## Metadata

Counts are over the 21 track pages read with the final code (every one had a hydrated track page).

| Fact | Where | Count | Notes |
|---|---|---|---|
| Title | `[data-testid="entityTitle"]` | 21 of 21 | also `h2` of the dialog |
| Artists | `[data-testid="creator-link"]` in `entity-header` | 21 of 21 | |
| Album id | `a[href^="/album/"]` inside `entity-header` | 17 of 21 | the 4 misses were not examined |
| Release year | `[data-testid="release-date"]` | 21 of 21 | **year only** |
| Full release date, track page | `<meta name="music:release_date">` | **0 of 21** in the hydrated page | the tag exists only in the server HTML sent to non-browser clients (a request with a plain `node`/`curl` user agent returned 207 meta tags, `2020-03-20`); a request with a Chrome user agent, and the extension's own `fetch` (2 of 2), got the 167 KB app shell with 5 meta tags and none of these |
| Full release date, album page | a `p` directly before the ℗/© block, text like "March 20, 2020" | 2 of 2 albums | localized text, so parse it in English; also needs the album page, not the track page |
| ℗ line | `main p` starting "℗" | 21 of 21 | e.g. "℗ 2020 The Weeknd XO, Inc., marketed by Republic Records, ..." |
| © line | `main p` starting "©" | 21 of 21 | |
| Label | dialog "Sources" value; also inside the ℗ line | Source present in every dialog read (about 35) | the label or ℗ owner, never a distributor (0 of 10 earlier; the ones checked now were Republic, Island, Hollywood, BMG, Parlophone, KARENT, Universal and similar) |
| ISRC | nowhere | **0 of 7**: the word does not occur in the page | not available without a signed-in API |
| Cover | `[data-testid="entity-header"] img` (`i.scdn.co`) | 21 of 21 | the `src` is the 300 px variant; its `srcset` lists up to 640w; larger sizes were not tried because `i.scdn.co` was not an approved host |
| Cover (full size) | `<meta property="og:image">` is 640x640 | only in the non-browser server HTML | same limitation as the release date |

Options for the full release date if it is needed: read it from the album page (English only), or fetch the track page with a custom `User-Agent` through a `declarativeNetRequest` rule (works in principle, since the server answers by user agent, but spoofing a client is a policy question and was not tried), or accept the year.

## Edge cases checked

| Case | Result |
|---|---|
| 30 or more rows | Track with 34 rows (album track 10 of 14): all 34 in the DOM at once, parsed fully; the dialog does not virtualize. A classical track with 25 rows and the extra "Other Roles" section also parsed. |
| Very few credits | Two white-noise tracks: Artist section with 2 rows plus Source; nothing else. Status `ok`. |
| Unusual characters | Japanese titles and artists (千本桜, 初音ミク), "Hoppípolla", symbols in an artist name (`[TEST]`, `×`): 5 tracks, all read; text is passed through as served, nothing was normalized. |
| Invalid / unknown id | `no-button` after the 10 s wait; the page is the generic web player shell. |
| Unavailable in the region | not found, see Unknown. |
| Consent banner | left alone; did not block `click()` in any of about 55 loads. |

## Unknown or not covered

- A track that exists but is unavailable in the user's country: no example was found within the budget, so the page state (greyed play button, missing options button, or a normal page) is not known.
  The og tag `og:restrictions:country:allowed` in the non-browser HTML lists markets and could be used if the provider ever fetches that, but it was not tested for a restricted track.
- A track with literally zero credits and no artist rows; none exists in the sample.
- Podcast episodes, local files and playlists.
- A signed-in view, and an EU profile's first-run consent flow.
- Off-screen windows from an extension (impossible via `chrome.windows`), and a Firefox or Safari run: all numbers are Chrome.
- Scrolling the album list in a hidden tab with another technique, for example a tab that is briefly visible.
- Why 4 of 21 header reads had no album id.
- Markup changes after 2026-10-31, and volumes beyond a few dozen loads per session.
- The role alias table has not been compared entry by entry with the live Genius dropdown (same caveat as section 12).

## Files

- `extension/scripts/lib/spotify-read.mjs`: reference reader (`spotifyReader()`, `readerSource`, `spotifyUrl`) and fixture sanitizers; `spotify-read.d.mts` has its types.
- `extension/scripts/live-spotify-probe.mjs`: opt-in live probe that loads a throwaway extension and runs the reader the way the provider would (`--steps "track/<id>@tab,album/<id>@tab"`, `--lang`, `--force-en`, `--capture`).
  It supersedes `live-spotify.mjs` and `live-spotify-open.mjs`, which used raw page scripts and could not reset a hidden page.
- `extension/test/spotify/`: sanitized fixtures (`credits-*.html`, `menu-*.html`, `album-page.html`) and `reader.test.ts` (19 tests: parsing in English and German, structural entry finder including the "must not pick Open in Desktop app" case, album rows, fake-page end-to-end for ok, no-button, no-item and the retry).
- Fixtures contain placeholders only ("Person N", "Sample Song", "Sample Label", `SAMPLE` ids); the old `credits-major.html` and `credits-self-released.html` stay as they were.
