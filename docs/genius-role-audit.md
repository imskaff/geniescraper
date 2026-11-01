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
| (d) No counterpart on the list, left for the user | 519 | 473 after the second pass (see Proposals and decisions) |

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

## Proposals and decisions

Decided on 2026-11-01.
"Applied" means the `ROLE_MAP` target changed (both apps, through the regenerated `roles.json` and `vectors.json`).
Nothing was checked on the live Genius form, so every alias below rests on the page and on the instrument or job being the same thing.

### AKA proposals from the page

| Apple label | Proposed | Decision |
|---|---|---|
| Chitarrone | Theorbo | Applied: the page lists it as an AKA and the instrument is the Roman theorbo. |
| Bukkehorn | Goat Horn | Applied: the page lists `Bukkehorn (Norwegian)` as an AKA of Goat Horn, and the name means goat horn. |
| Vocal Recording Engineer | Recording Engineer | Kept as `Vocal Engineer`: that name was measured on the live form and is listed too; the narrower role keeps the vocal meaning. |
| Editing Engineer | Audio Editor | Left for the user for now: the page does list the AKA, but the earlier live measurement found nothing close and the autoPage test relies on it. Re-measure on the form before switching. |
| Rap | Vocals | Left out on purpose: drops the rap information. |
| Gang Vocals | Additional Vocals | Left out on purpose: wider than additional. |
| Score Editor | Preparer | Left out: not obviously the same job. |
| Mouth Harp | Jew's Harp | Left out: the page also uses the name as a Harmonica note. |
| Bass Harp | Bass Harmonica | Left out: a bass harp is a different instrument. |
| Basset Recorder | Bass Recorder (Woodwind) | Left out: a basset and a bass recorder differ. |
| Soprano Trombone | Slide Trumpet | Flag: the instruments are historically related, but Apple's meaning is unclear. |
| Videographer | Video Director Of Photography | Left out: a different video job. |
| Horn, Pipes | Horns, Pipe | Left out: a French horn is not a horn section, and Pipes may mean bagpipes (`nearMissProposals`). |

### Similarity-only candidates

Applied, because each is the same instrument, job or credit under another name and the target is an exact listed role:
Cornetto to Cornett, Steel Drum to Steelpan, Vibes to Vibraphone, Moog to Moog Synthesizer, Farfisa to Farfisa Organ,
Synclavier to Synclavier Synthesizer, Wurlitzer Piano to Wurlitzer Electric Piano, Tanpura to Tambura (same instrument, and `Tamboura` already maps there),
Doumbek to Darbuka, Choral Conductor to Choir Conductor, Chorus Director to Choir Director, Photo Editor to Photography Editor,
Sound Design to Sound Designer, Music Supervisor to Musical Supervision, Cover Art to Artwork (the page gives `Cover` as an AKA of Artwork),
Immersive Audio Engineer to Immersive Engineer (the page's AKAs are surround and Atmos engineers).

Not applied, flagged for the owner:
Illustrator to Illustration, Tap Dancer to Tap Dance and Cover Photography to Photography (person versus activity naming, and the cover scope is lost);
Beats to Beatmaker (unclear what Apple means); Co-Executive Producer to Executive Producer, Studio Technician and Equipment Technician to Technician (each drops a qualifier);
Post Production Mixing Engineer to Post Mixing Engineer and Assistant Editing Engineer to Assistant Audio Editor (the second depends on the Editing Engineer decision);
Engraving to Engraving (Artwork) (Apple means music engraving, the listed role is artwork).

### Scan of the rest of the unlisted targets

The 473 targets still unlisted were sorted by kind; all stay with the user on purpose, because Genius has no counterpart:

- Ensembles and groups (`... Ensemble`, `... Quartet`, `... Orchestra`, `... Choir`, `Band`, `Group`, duos and trios):
  Genius lists only the generic `Ensemble`, `Orchestra` and `Choir`; collapsing them would lose the information.
- Period and regional instruments (`Baroque ...`, `Historical ...`, `Renaissance ...`, `Medieval ...`, the Chinese, Persian and Turkish instruments such as `Gaohu`, `Guqin`, `Tar`): no listed role.
- Counted string guitars and basses (`12-String Guitar`, `5-String Bass Guitar` and so on): the page lists only Six-String and Seven-String variants; mapping to `Guitar` or `Bass Guitar` would drop the detail.
- Production, post-production, film and stage credits (`Film Director`, `Costume Design`, `Post Production ...`, `Stage Director`): the page has only `Video ...` variants, which mean a music video.
- Score and text credits (`Libretto Editing`, `Realization (figured bass)`, `Cadenza`, `Translation`, `Lyrics`): no counterpart or a different meaning.
- `Performer`, `Mixed Artist` and `Songwriter` are skipped or handled as fields, not typed as roles.

## Listed roles no Apple label reaches (category f)

1,258 listed roles are not a `ROLE_MAP` target.
Most are Genius-only: 650 instrument entries, 118 video roles, 90 `Additional ...` roles, 43 other, 31 instrument solos, 28 artwork roles and 11 locations.
The `Programmer` family is reached through `genius_role_name`, and `Additional Production` through `geniusRole`, not through `ROLE_MAP`.
Whether Apple emits another label for any of these (for example the `Additional ...` family, `Pre-Producer`, `Sampling` or the `... Orchestration` roles) cannot be established offline.
It needs a scan of real Apple credits pages and is the natural follow-up.

## Verification notes

`extension/test/package.test.ts` has two failures in this Windows checkout that predate this change: the store listing is read with CRLF line endings because `core.autocrlf` is true, and the test regex expects LF.
