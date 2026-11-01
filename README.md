<div align="center">

<img src="img/geniescraper.png" alt="Géniescraper logo" width="360">

<h1>Géniescraper</h1>

<p><b>Apple Music and Spotify metadata straight into Genius</b></p>

<p>
Géniescraper reads the credits of an Apple Music or Spotify page and fills them into the Genius metadata form for you:<br>
songwriters, producers, every additional role, the ℗ and © lines, the exact cover art and the official YouTube video.<br>
It never presses Save: you check the form and save it yourself.
</p>

<p>
<b><a href="#features">Features</a> ·
<a href="#installation">Installation</a> ·
<a href="#usage">Usage</a> ·
<a href="#configuration">Configuration</a></b>
   
<a href="extension/FAQ.md">FAQ</a> ·
<a href="extension/PRIVACY.md">Privacy</a> ·
<a href="#contact">Contact</a> ·
<a href="#disclaimer">Disclaimer</a>
</p>

</div>

> [!TIP]
> **<ins>Start with the browser extension.</ins>** It does everything inside your browser, fills the form by itself (***Auto-paste***), skips names that are already filled in and only ever picks an exact artist match.
> The desktop app works best with the extension connected; on its own it can only paste with hotkeys into whichever field you click.

## Features

### Reading the credits

- 🔍 **Finds what you have open** – The extension listens for Apple Music and Spotify albums and songs already open in your browser and offers each one in a single press, labelled with where it is from. The desktop app lists the Apple Music ones too once the two are paired.
- 🎵 **Apple Music and 🟢 Spotify** – Spotify tracks and albums are read from their credits box by the extension. The desktop app does not read Spotify.
- 🎼 **Complete credits** – Songwriters, producers, every additional role, the ℗ / © lines and the release date of an album or a song, with roles named the way Genius names them.
- 🖼️ **Exact cover art** – The 1000×1000 PNG of the exact release you opened, found by its Apple Music catalog ID. For Spotify, which has no such ID, it is found by title and artist in Apple's catalog, and then on Deezer.
- ▶️ **The right YouTube link** – No more manual search for the correct YouTube link.
- ⚡ ***Extremely fast*** – The credits of a track take a few seconds and the next tracks of an album are read in the background while you paste.

### Pasting into Genius

- 🔗 **Open on Genius** – One press finds the song on Genius, opens it in a new tab and presses its Edit Metadata button for you. It only does so when exactly one Genius song matches the title and artist; with none or several, it stops and tells you instead of guessing. An existing Genius tab is never navigated away, so a form you are editing is safe.
- 🤖 ***Auto-paste*** – The whole track is filled in field by field while you watch. It pauses the moment you click or type in the form, press `Esc` or close the panel, and carries on from the same step when you turn it back on.
- 👣 **Step by step** – Prefer control? Use the customizable shortcuts for pasting, going back or skipping a field in the form.
- 🎯 **Exact matches only** – A suggestion is chosen only when it matches the typed name exactly (ignoring case, accents and symbols). Otherwise the text stays typed and the choice is yours, so a near match never ends up on a song.
- ♻️ **Knows what is already there** – Names already filled in are skipped, empty rows are reused and artists are added to roles Genius already lists, instead of creating duplicates.
- 🛡️ **Never saves for you** – The extension never clicks Save or Cancel, making *you* in control.

### One workflow, two apps

|                           | Browser extension                                   | Desktop app                                                  |
|---------------------------|-----------------------------------------------------|--------------------------------------------------------------|
| **Runs on**               | Chromium (Chrome, Brave, Opera, Arc, etc.) and Edge, Windows and macOS| Windows                                    |
| **Reads the credits**     | Yes, Apple Music and Spotify, from the pages you have open | Yes, Apple Music only, with its own browser (Playwright) |
| **Fills the Genius form** | Yes: Auto-paste or step by step, exact matches only | Through the extension once paired; otherwise manual hotkeys  |
| **Finds open pages**      | Yes, Apple Music and Spotify                        | Yes, Apple Music pages, once paired                          |
| **Install**               | Download, unzip, load                               | Clone, `uv sync`                                             |

## Installation

### Browser extension <ins>(recommended)</ins>

<img src="img/extension-demo.gif" alt="The side panel listening for Apple Music pages, finding one, reading the album and pasting the credits automatically" width="720">

The steps are the same on **Windows** and **macOS**, apart from how you unzip the download (step 2) and how you check it.

1. **Download.** Open the [Releases page](https://github.com/imskaff/geniescraper/releases), pick the newest **Géniescraper extension** and download `geniescraper-extension-<version>.zip`.
2. **Unzip it into a folder you will keep.** The browser runs the extension from that folder, so do not delete or move it afterwards.
   - **Windows:** right-click the zip, choose **Extract All…** and pick a place you will keep, for example `Documents\Geniescraper-extension`.
   - **macOS:** double-click the zip in Finder: a folder with the same name appears next to it. Drag that folder into `Documents` (or any place you will keep) rather than leaving it in `Downloads`.
3. **Add it to your browser** (the same on both systems).
   - **Chrome:** open `chrome://extensions`, switch on **Developer mode** (top right), click **Load unpacked** and choose the folder from step 2, the one that contains `manifest.json`.
   - **Edge:** open `edge://extensions`, switch on **Developer mode** (left side), click **Load unpacked** and choose the same folder.
4. **Open it.** Click the puzzle-piece icon in the toolbar, pin Géniescraper, then click it. The side panel opens and a short set-up walks you through the options.

> [!NOTE]
> Chrome may show **Disable developer mode extensions** when it starts. Choose to keep them: it is Chrome's standard notice for any extension that does not come from the store.

> [!NOTE]
> **Support for more browsers (Firefox, Safari) coming soon.**

**Good to know**

- **Updating.** Download the newest zip and unzip it over the same folder, replacing the files (on macOS, choose **Replace** when Finder asks), then press the reload icon on the extension's card in `chrome://extensions`. The extension does not update itself.
- **Checking a download.** Compare its SHA-256 with `SHA256SUMS.txt` from the same release.
  - **Windows** (PowerShell): `Get-FileHash .\geniescraper-extension-<version>.zip -Algorithm SHA256`
  - **macOS** (Terminal): `shasum -a 256 geniescraper-extension-<version>.zip`
- **Permissions.** Chrome shows the install-time access (Genius, Apple Music, iTunes and Deezer, which is the cover fallback) when you load the extension. Access to `open.spotify.com` is asked for later, the first time you press **Get credits** on a Spotify page.
- **Questions and fixes:** [extension/FAQ.md](extension/FAQ.md).

### Desktop app (Windows)

> [!NOTE]
> The desktop app runs on **Windows only**. On a Mac, use the browser extension above: it does everything on its own.

**You need:** Windows, **Python 3.10 or newer** and **[uv](https://docs.astral.sh/uv/)** (`pip install uv`).

1. **Clone the repository:**
   ```bash
   git clone https://github.com/imskaff/geniescraper.git
   cd geniescraper
   ```

2. **Install the dependencies** (creates `.venv` from the locked versions in `uv.lock`):
   ```bash
   uv sync
   ```
   Without uv, `pip install -r requirements.txt` also works, with unpinned versions.

3. **Install the browser the app reads Apple Music with:**
   ```bash
   uv run playwright install chromium
   ```

4. **Start it:**
   ```bash
   uv run python gui_main.py
   ```

### Connect the desktop app to the extension

Pair them once; the pairing is remembered. This is optional but recommended: it gives the desktop app Auto-paste, exact artist matching and the list of Apple Music pages you have open.

1. In the desktop app, press **Connect browser extension** (on the start screen, or at the top of **Settings**). A code like `ABCD-EFGH` appears, with a **Copy** button.
2. In the extension, open **Settings**, scroll to **Desktop app**, paste the code (the **Paste** button in the box does it) and press **Pair**.
3. Both sides show **Connected**.

> [!IMPORTANT]
> The code is valid for two minutes and works once; a new one can be requested only after it has run out. Pairing shares no Genius password and the link never leaves your computer. **Unpair** (extension) or **Forget pairing** (desktop app) cuts it at any time.

## Usage

### With the browser extension

1. **Open an album or a song on Apple Music or Spotify** and click the Géniescraper icon. The panel offers the page you are on, and any other Apple Music or Spotify pages you have open appear under **Listening for Apple Music or Spotify pages…**. Pick one, or paste a link and press **Get credits**.
2. **Choose the tracks** of an album with **Select all** or by ticking them (none are ticked for you). Their credits are read in the background.
3. **Review** each track: the credits, the ℗ / © lines, the cover and the YouTube link that will be pasted. A track that says **Needs a look** is missing something; open it to see what.
4. **Open the song's Edit Metadata form on Genius** (signed in, in the same browser) and press **Start pasting**. To let the extension do the opening, press **Open on Genius** in the panel (beside **Start pasting**, and next to the track's name while pasting): it finds the exact song, opens the page in a new tab and presses **Edit Metadata**. With none or several matches it says so and opens nothing; signed out, it tells you to sign in.
5. **Paste.** The panel shows the current step and these controls:

   | Control                | What it does                                                                                      |
   |------------------------|---------------------------------------------------------------------------------------------------|
   | **Auto-paste: ON/OFF** | ON fills the whole track by itself; OFF hands the steps to you. Pauses when you touch the form.   |
   | **Next** (`F8`)        | Fills the next field. Shown while Auto-paste is off.                                              |
   | **Previous** (`F7`)    | Goes back one step.                                                                               |
   | **Skip**               | Leaves the current field alone.                                                                   |
   | **Back to credits**    | Stops pasting and returns to the credits.                                                         |

6. **Check the form and save it on Genius yourself.** Nothing is saved for you.

When Genius has no exact match for a name or a role, the text stays typed and nothing is chosen for you: pick a suggestion yourself or press **Skip**. A few Apple roles have no Genius equivalent; those steps are left for you.

**Reading from Spotify**

- **The permission.** Chrome only shows its prompt after a click, so it appears when you press **Get credits** on a Spotify page for the first time: the panel first explains what will happen, and its **Allow access to Spotify** button asks Chrome for access to `open.spotify.com`. If you refuse, Apple Music keeps working. Until you allow it, your open Spotify tabs are not listed.
- **How it reads.** The extension opens the Spotify page in a hidden window, presses Spotify's own **View credits** button and reads the names and roles in the box that opens, a few pages at a time, and closes the window. It never signs in and sends nothing anywhere.
- **What a Spotify read cannot give.** Spotify's credits box shows no ISRC and no release date for a track, so the release date is read from the track's public embed page (an album read also uses the album page's English date line); a release Spotify knows only by year is left empty. The panel says so under **About this read**.
- **Languages.** Spotify writes role names in the language of its page, so the extension opens the English version of the page (it adds `?locale=en` to the address of its own hidden window, which changes nothing in your account or your own tabs) and every role comes back in English. That parameter is not documented by Spotify: if the page does not come back in English, the extension falls back to its role words for German, Spanish, French, Portuguese, Italian, Dutch, Polish, Swedish, Turkish, Japanese, Korean and Russian, and roles in other languages are then left out and listed under **About this read**, which names the language Spotify showed only in that case. Roles are typed under the exact names on Genius's standardized list; one Genius has removed (such as Studio Personnel) is left out and listed under **About this read**.
- **Long albums.** A hidden Spotify page lists only about the first 25 tracks, so the rest are marked **No Spotify page**. Open such a track on its own page and read it from there.

> [!TIP]
> **On a Mac,** the `F7` and `F8` keys are usually media keys. Hold `Fn` while you press them, or turn on **Use F1, F2, etc. keys as standard function keys** in **System Settings → Keyboard → Keyboard Shortcuts… → Function Keys**. The **Next**, **Previous** and **Skip** buttons in the panel work without the keys.

> [!TIP]
> The first time the panel opens, a short set-up walks you through what to paste, the speed and keys, and the optional lookups. Everything in it can be changed later in **Settings**.

### With the desktop app

```bash
uv run python gui_main.py
```

1. **Link.** Paste an Apple Music album or song link and press **Get credits**. With the extension paired, the albums and songs open in your browser are listed here: click one to get its credits. Album links are best, because they include the copyright lines.
2. **Tracks.** For an album, tick the songs to paste, or choose all of them.
3. **Review.** Check the credits, copyright lines, YouTube link and cover art that were found, then press **Start pasting**.
4. **Paste.** Open the song's Edit Metadata form on Genius. The pasting screen follows the extension's: **Auto-paste: ON/OFF**, **Next** (`F8`), **Previous** (`F7`), **Skip** and **Back to credits**, with the steps below.
   - **Extension connected:** Auto-paste is available and the extension fills the form; the desktop app shows the progress.
   - **No extension connected:** the screen shows a **Manual mode** card with a **Connect browser extension** button, and the hotkeys work as described below.

A glowing **Connect your browser extension** card on the start screen appears whenever no extension is connected.

### Manual mode (desktop app without the extension)

> [!WARNING]
> Without the extension the app cannot see Genius. You click each field yourself, then press `F8`; it cannot tell what is already filled in (use **Skip** for those), and it presses Enter on whatever suggestion Genius shows first, so it cannot check that an artist with that name exists. This mode is kept as it is and is not being developed further.

- Click the field on Genius, then press `F8` (or the **Next** button, which first switches back to the last Genius page you had in front, and pastes nothing if there is none) to paste the current value and move on. `F7` goes back, **Skip** leaves a field alone, `Esc` ends pasting for the song.
- After each paste the app moves between Genius fields and confirms the suggestion for you:

  | After pasting…                 | Action                                   |
  |--------------------------------|------------------------------------------|
  | Last songwriter                | `Tab` → Produced By field                |
  | Last songwriter (no producers) | `Tab` × 2 + `Enter` → Add additional credits |
  | Last producer                  | `Tab` + `Enter` → Add additional credits |
  | Last artist in a role          | `Tab` + `Enter` → Add additional credits |
  | Last copyright label           | `Tab` × 3 → YouTube URL field            |
  | YouTube URL                    | `Tab` × 3 → Cover Art field              |

### Field order

Fields are pasted in the order Genius expects them:

| #   | Field                      | Notes                                    |
|-----|----------------------------|------------------------------------------|
| 1   | Written By                 | One artist per press                     |
| 2   | Produced By                | One artist per press                     |
| 3   | Additional Credits         | Role name, then each artist in that role |
| 4   | Label, Distributor         | Only when the ℗ line makes them clear    |
| 5   | Phonographic Copyright (℗) | Role name typed, then each label         |
| 6   | Copyright (©)              | Role name typed, then each label         |
| 7   | YouTube URL                | Pasted, or copied to the clipboard       |
| 8   | Cover Art URL              | 1000×1000 PNG, pasted or copied          |
| 9   | Release Date               | Month, day and year dropdowns            |

Label and Distributor are derived from the ℗ line with a reviewed table (`scraper/labels.py`): "℗ 2026 Atlantic Recording Corporation" gives Label "Atlantic Records" and Distributor "Warner Music Group".
A "distributed by" in the line is used as written.
An Apple Music `/song/` link has no copyright footer, so its ℗ and © lines come from the iTunes lookup of the album the song belongs to (best effort, empty on failure).
When the line names no known label, or names labels of different groups, the field is left empty - never guessed.
They follow the copyright toggle; the pairs are the same `role`/`artist` queue items as any other additional credit.

## Configuration

Both apps have a **Settings** screen. In the desktop app it opens over any screen, and changes are applied and saved when you close it.

### Browser extension

| Card                   | What you can set                                                                                                                      |
|------------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| **What to paste**      | Songwriters and producers, additional credits, copyright lines, YouTube link, PNG cover art link, release date.                                |
| **Pasting on Genius**  | Auto-paste on or off, the pause between fields (0.6 s by default), the keys (`F8` and `F7`), how long to wait for suggestions, what happens after a track, and **Open each song on Genius before pasting it**. |
| **Reading credits**    | How many tracks are read at the same time (3 by default).                                                                              |
| **YouTube links**      | Find a YouTube link for each track (recommended), and an optional free YouTube key for more reliable links; the panel walks you through getting one. |
| **Desktop app**        | Pair with the desktop app: pairing code, **Paste**, **Pair**, **Unpair**.                                                              |

The YouTube lookup is off until you tick it; the browser then asks for permission to contact `www.youtube.com`, and you can take it back in Settings or in `chrome://extensions`.
Deezer is always the cover fallback and has no setting.

### Desktop app

| Setting                            | Default | Description                                                          |
|------------------------------------|---------|----------------------------------------------------------------------|
| **Auto-paste**                     | On      | Needs the extension to be connected; greyed out otherwise            |
| Songwriters and producers          | On      | Written By and Produced By                                           |
| Additional credits                 | On      | Every other role                                                     |
| Copyright lines (℗ and ©)          | On      | From album links                                                     |
| YouTube link                       | On      | Pasted into Genius's YouTube field                                   |
| PNG cover art link                 | On      | 1000×1000 PNG of the exact release                                   |
| Release date                       | On      | Month, day and year, in the three Release Date dropdowns             |
| Keys                               | F8 / F7 | Paste next / go back one step                                        |
| Wait for suggestions to settle     | 0.6 s   | Hotkeys only: how long to wait before pressing Enter                 |
| Tracks read at the same time       | 3       | How many album tracks are read while you paste                       |
| Find a YouTube link for each track | On      | Looks the link up on YouTube (recommended); off skips the search     |
| Search Deezer for a cover          | On      | Only asked when Apple Music has no cover of its own                  |
| Always on top                      | On      | Keep the window above the browser                                    |
| Compact assistant                  | Off     | Hide the step list and shrink the window                             |
| Start the assistant automatically  | Off     | Start pasting after a countdown (15 s by default)                    |

Settings are saved per user in `%APPDATA%\Geniescraper\settings.env`, so every copy of the app shares them.
A `.env` in the project root from older versions is still read until the first save.

## Privacy

**[Learn more here](extension/PRIVACY.md)**

- No accounts, no analytics, no servers of ours. Everything stays in your browser and on your computer.
- The link between the extension and the desktop app stays on your computer (`127.0.0.1`), needs a one-time pairing code and never shares your Genius sign-in: you stay signed in to Genius in your own browser.
- **Open on Genius** sends the song title and artist to Genius's own search, only when you press it (or turn on opening each song before pasting). No cookies, no sign-in and nothing goes to anyone else.
- YouTube lookups are optional and ask your permission first. An optional YouTube key stays in your browser and is sent only to Google.
- Reading Spotify is optional too: Chrome asks for access to `open.spotify.com` the first time you press **Get credits** on a Spotify page, after the panel has explained why. Nothing read from Spotify is sent anywhere.
- When Apple's catalog has no cover for a song (always the case for a Spotify link), the extension asks Deezer, sending only the song title and artist. That permission is part of the install and cannot be switched off.

## Contact

Contact me on [Genius](https://genius.com/5kf) or by [opening an Issue here](https://github.com/imskaff/geniescraper/issues/new/choose).

## Donate

Géniescraper is free, [you can support my work by clicking here](https://buymeacoffee.com/imskaff). Thank you!

## Disclaimer

Géniescraper is an independent, unofficial project. It is **not affiliated with, endorsed by or sponsored by Genius.com (Genius Media Group Inc.) or Apple Inc.** "Genius" and "Apple Music" are trademarks of their respective owners, named here only to say what the tool works with.

It reads the Apple Music pages you open yourself and fills the Genius form of your own signed-in session. It never handles your Genius password and never saves for you: you check the form and save it yourself. Please use it in line with the terms of the services you use.

Géniescraper is free. If it helps you, you can [buy me a coffee](https://buymeacoffee.com/imskaff).

## License

MIT - see [LICENSE](LICENSE).
