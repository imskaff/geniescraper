# Genius role name audit

Source of truth for the audit: Genius's own page "Standardized Additional Roles" (https://genius.com/Community-guides-standardized-additional-roles-annotated), read on 2026-11-01.
It is saved as `tests/fixtures/genius-standardized-roles.json`: 18 sections, 1,741 roles, each with its section, album-level flag, AKAs and notes.
The reviewed set of names Genius does not list is `tests/fixtures/genius-unlisted-role-targets.json`.
`tests/unit/test_genius_role_names.py` and `extension/test/core/geniusRoleNames.test.ts` pin every role name the app can type to these two files, so a new misspelled or unlisted target fails a test.

## What was audited

- `ROLE_MAP` in `scraper/roles.py`: 984 Apple labels, 972 distinct Genius names before this change, 963 after.
- The name that is actually typed is `genius_role(ROLE_MAP[key])` (`assistant/flow.py`, `extension/src/core/geniusRoles.ts`).
  That step turns `Additional Producer` into `Additional Production`, `Vocal Recording Engineer` into `Vocal Engineer`, and `<X> Programming` into `<X> Programmer`, so those are not findings.
- The Spotify tables (`extension/src/spotify/roles.ts`, `roleTables.ts`) against the same file.
- Songwriter and Producer are the Written By and Produced By fields, and Performer and Mixed Artist are skipped.
  Roles Genius does not list are left for the user on purpose.
  None of that changed.

The page tags some AKAs with their source, for example `Orchestrator (AM)` (Apple Music) and `Second Engineer (Tidal)`.
The AM tag is the strongest evidence the page gives for this app, and it is why `Orchestrator` is now typed as `Orchestration`.

## Numbers

Each distinct target is counted once.

| Category | Before | After |
|---|---|---|
| Distinct targets | 972 | 963 |
| (a) Exactly a listed role | 424 | 471 |
| (b) Differs from a listed role or AKA by case, spelling, hyphen, plural or order | 28 | 0 fixed-class; 12 AKA-only names and 2 near misses remain as proposals |
| (c) Listed under Major Roles Removed (`Studio Personnel`) | 1 | 1, now skipped like Performer |
| (d) No counterpart on the list, left for the user | 519 | 491 (includes the 14 proposals) |

Of the 471 listed targets, 355 are instruments, 23 studio roles, 19 vocal roles, 15 choir and orchestra roles, 14 arranger roles, and the rest are spread over the other sections.

## Applied (56 target names)

All are spelling or equivalence fixes to an exact listed name.
No golden file, fixture or benchmark case contains an old name (checked by search before editing), so nothing under `tests/golden` changed.
`extension/data/roles.json` and `extension/test/vectors.json` were regenerated with `tools/export_roles.py` and `tools/export_vectors.py`.

### Voice types

| Was | Now |
|---|---|
| Alto (Vocal) | Alto Vocals |
| Baritone (Vocal) | Baritone Vocals |
| Bass (Vocal) | Bass Vocals |
| Bass-Baritone (Vocal) | Bass-Baritone Vocals |
| Contralto (Vocal) | Contralto Vocals |
| Counter-Tenor (Vocal) | Countertenor Vocals |
| Mezzo-Soprano (Vocal) | Mezzo-Soprano Vocals |
| Soprano (Vocal) | Soprano Vocals |
| Tenor (Vocal) | Tenor Vocals |


### Accents

| Was | Now |
|---|---|
| Baglama | Bağlama |
| Bandoneon | Bandoneón |
| Batá Drums | Batá Drum |
| Birbyne | Birbynė |
| Cajon | Cajón |
| Cuica | Cuíca |
| Guitarron | Guitarrón |


### Hyphen, case, spelling

| Was | Now |
|---|---|
| C-Melody Saxophone | C Melody Saxophone |
| Great Bass Recorder | Great-Bass Recorder |
| Hi-Hat | Hi-hat |
| Hurdy Gurdy | Hurdy-Gurdy |
| Nylon-String Guitar | Nylon String Guitar |
| Talkbox | Talk Box |
| Hand Claps | Handclaps |
| Clap Stick | Clapsticks |
| Tamboura | Tambura |
| Contralto Clarinet | Contra-Alto Clarinet |
| Recorder | Recorder (Woodwind) |
| Bass Recorder | Bass Recorder (Woodwind) |


### Plural, singular, word order

| Was | Now |
|---|---|
| Cymbals | Cymbal |
| Paintings | Painting |
| Tom-Toms | Tom-Tom |
| Wind Chimes | Wind Chime |
| Virginal | Virginals |
| Woodwinds | Woodwind |
| Taiko Drums | Taiko |
| Horn Arranger | Horns Arranger |
| Horn Conductor | Horns Conductor |
| Keyboard Arranger | Keyboards Arranger |
| Keyboard Technician | Keyboards Technician |
| String Conductor | Strings Conductor |
| Lead Acoustic Guitar | Acoustic Lead Guitar |
| Additional Engineer | Additional Engineering |


### Names the page gives as the same role (AKA)

| Was | Now |
|---|---|
| Assistant Conductor | Associate Conductor |
| Contrabass | Double Bass |
| Overdub Engineer | Overdub Recording Engineer |
| Synth Bass | Bass Synthesizer |
| String Arranger | Strings Arranger |
| Upright Bass | Double Bass |
| Treble Recorder | Alto Recorder |
| Tenor Horn | Alto Horn |
| Toasting | MC |
| Viola da Gamba | Viol |
| Zarb | Tombak |
| Finger Cymbals | Zills |
| Violoncello | Cello |
| Orchestrator | Orchestration |

### Studio Personnel

Genius lists it under Major Roles Removed.
The `studio personnel` key stays in `ROLE_MAP` on purpose: the text walk uses the known keys to start a new credit, and without it the artists after the heading would attach to the previous role.
The role is now skipped like Performer, in `_SKIP_ROLES` (`scraper/apple_music.py`) and `SKIP_ROLES` (`extension/src/apple/credits.ts`), with a parity vector for both parsers.
On Spotify the alias is gone and the fallback to Apple's names ignores it, so `Studio Personnel` is left out (`spotifyRole` returns `null`).

### Spotify

- `Bass (Vocal)` is now `Bass Vocals` (the alias and the 12 language tables).
- `Recording Second Engineer` was left out before; it is now `Assistant Engineer` in English and in the 11 language tables (every label was observed in the real reads).
  Why `Assistant Engineer`: the page lists `Assistant Engineer` with the AKA `Second Engineer (Tidal)`, which is the page's own statement for a second engineer.
  The narrower alternative is `Assistant Recording Engineer`, also listed exactly; switch if the owner prefers it.

## Proposals (not applied)

Each needs the owner's call because the equivalence is debatable or it contradicts a decision measured on the live form.

| Apple label | Proposed | Why it was not applied |
|---|---|---|
| Vocal Recording Engineer | Recording Engineer | The page lists it as an AKA of Recording Engineer, but the code maps it to `Vocal Engineer` (measured on the form; that role exists too). Pick one. |
| Editing Engineer | Audio Editor | The page lists it as an AKA, while `extension/src/core/geniusRoles.ts` says Genius has nothing close. The comment is outdated if the page is right. |
| Rap | Vocals | Page AKA, but it drops the rap information. |
| Gang Vocals | Additional Vocals | Page AKA; the meaning is wider than additional. |
| Score Editor | Preparer | Page AKA; not obviously the same job. |
| Chitarrone | Theorbo | Page AKA; related but distinct instruments. |
| Mouth Harp | Jew's Harp | The page also uses the name as a Harmonica note, so it is ambiguous. |
| Bass Harp | Bass Harmonica | A bass harp is also a different instrument. |
| Basset Recorder | Bass Recorder (Woodwind) | Page AKA, but a basset and a bass recorder differ. |
| Soprano Trombone | Slide Trumpet | Page AKA; Apple's meaning is unclear. |
| Videographer | Video Director Of Photography | Video role. |
| Horn | Horns | French horn versus a horn section. |
| Pipes | Pipe | The plural may mean bagpipes. |

Candidates with no AKA on the page, found by similarity only.
Check what Apple emits before changing any of them:
Cornetto to Cornett, Illustrator to Illustration, Tap Dancer to Tap Dance, Sound Design to Sound Designer,
Choral Conductor to Choir Conductor, Chorus Director to Choir Director, Photo Editor to Photography Editor,
Cover Photography to Photography, Immersive Audio Engineer to Immersive Engineer,
Post Production Mixing Engineer to Post Mixing Engineer, Assistant Editing Engineer to Assistant Audio Editor,
Music Supervisor to Musical Supervision, Co-Executive Producer to Executive Producer, Vibes to Vibraphone,
Steel Drum to Steelpan, Moog to Moog Synthesizer, Farfisa to Farfisa Organ, Synclavier to Synclavier Synthesizer,
Wurlitzer Piano to Wurlitzer Electric Piano, Doumbek to Darbuka, Tanpura to Tambura, Beats to Beatmaker, Cover Art to Artwork,
Engraving to Engraving (Artwork), Studio Technician and Equipment Technician to Technician.

The 12 `N-String` instruments (for example `12-String Guitar`) have no exact listed role, because the page lists only Six-String and Seven-String variants, so they stay with the user.

## Listed roles no Apple label reaches (category f)

1,258 listed roles are not a `ROLE_MAP` target.
Most are Genius-only: 650 instrument entries, 118 video roles, 90 `Additional ...` roles, 43 other, 31 instrument solos, 28 artwork roles and 11 locations.
The `Programmer` family is reached through `genius_role_name`, and `Additional Production` through `geniusRole`, not through `ROLE_MAP`.
Whether Apple emits another label for any of these (for example the `Additional ...` family, `Pre-Producer`, `Sampling` or the `... Orchestration` roles) cannot be established offline.
It needs a scan of real Apple credits pages and is the natural follow-up.

## Verification notes

`extension/test/package.test.ts` has two failures in this Windows checkout that predate this change: the store listing is read with CRLF line endings because `core.autocrlf` is true, and the test regex expects LF.
