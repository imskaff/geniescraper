<div align="center">
<img src="img/geniescraper.png" alt="Géniescraper logo" width="400">

# Géniescraper

**Géniescraper** is a Python-based tool that bridges Apple Music credits and Genius.com metadata entry. It uses stealth browser automation to extract songwriters, producers, roles, copyrights, and cover art, then provides a hotkey-driven GUI assistant to paste everything directly into Genius - 100% in accordance with the guidelines.

</div>

## Features

- 🕵️ **Stealth Extraction**: Built on Playwright with stealth patches to reliably scrape Apple Music (albums and single tracks) without being blocked.
- ⌨️ **Hotkey Assistant**: A floating, always-on-top window that guides you step-by-step through the Genius pasting workflow. Press `F8` to paste the next field, `F7` to go back. The Start Assistant button also shows your configured keybind so you can trigger it from the keyboard.
- 🤖 **Auto-Tab**: Automatically presses Tab (and Enter where needed) between Genius fields so you rarely need to touch the keyboard between hotkey presses. Works across all field transitions.
- ✅ **Auto-Confirm**: Presses Enter after each paste to select the autocomplete suggestion in Genius dropdowns.
- 🖼️ **Consistent Cover Art**: Always fetches the 1000×1000 PNG version of the cover art from Apple Music, regardless of the source URL format.
- ⚡ **Background Prefetch**: When working through an album queue, the next 1–2 tracks are scraped in the background while you paste the current one — advancing to the next track is instant.
- 🎛️ **Fully Configurable**: Options menu to rebind hotkeys, toggle which fields to include, enable Auto-Tab / Auto-Confirm / Compact Mode / Auto-Start, and set the auto-start countdown.

## Installation

### Prerequisites
- **Python 3.10+**

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/imskaff/geniescraper.git
   cd geniescraper
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Install Playwright browsers:**
   ```bash
   playwright install chromium
   ```

## Usage

```bash
python gui_main.py
```

1. **Scrape** — Paste an Apple Music URL into the URL bar (use the 📋 button or `Ctrl+V`) and click **Scrape**. Use an `/album/` URL when possible so that copyright data (℗ / ©) is available.
2. **Select track** — If you pasted an album URL, pick the specific track from the list.
3. **Start Assistant** — Click **Start Assistant**. The window becomes always-on-top.
4. **Paste to Genius** — Open the Genius song edit page. Follow the on-screen instructions for each field:
   - Press **F8** to paste the current value and advance.
   - Press **F7** to step back one field.
   - Press **ESC** to cancel and return to the main menu.

### Field order

The assistant pastes fields in the order Genius expects them:

| # | Field | Notes |
|---|-------|-------|
| 1 | Written By | One artist per press |
| 2 | Produced By | One artist per press |
| 3 | Additional Credits | Role name, then each artist in that role |
| 4 | Phonographic Copyright (℗) | Role name typed, then each label |
| 5 | Copyright (©) | Role name typed, then each label |
| 6 | YouTube URL | Copied to clipboard |
| 7 | Cover Art URL | 1000×1000 PNG, copied to clipboard |

### Auto-Tab

When **Auto-Tab** is enabled in Settings, the assistant automatically navigates between Genius fields after each paste:

| After pasting… | Action |
|---------------|--------|
| Last songwriter | Tab → Produced By field |
| Last songwriter (no producers) | Tab × 2 + Enter → Add additional credits |
| Last producer | Tab + Enter → Add additional credits |
| Last artist in a role | Tab + Enter → Add additional credits |
| Last copyright label | Tab × 3 → YouTube URL field |
| YouTube URL | Tab × 3 → Cover Art field |

Auto-Tab is disabled by default.

## Configuration

Open **⚙ Options** from the main menu:

| Setting | Default | Description |
|---------|---------|-------------|
| Hotkey (Next) | F8 | Paste current field and advance |
| Hotkey (Back) | F7 | Step back one field |
| Auto-confirm | On | Press Enter after paste to confirm autocomplete |
| Auto-tab | Off | Automatically Tab between Genius fields |
| Compact mode | Off | Hide queue list and shrink the window |
| Auto-start assistant | Off | Start automatically after a countdown |
| Auto-start delay | 15 s | Seconds before auto-start fires |
| Scrape core credits | On | Songwriters and producers |
| Scrape additional credits | On | All other roles |
| Scrape copyright | On | ℗ and © |
| Scrape YouTube | On | YouTube video/MV link |
| Scrape cover art | On | Album cover at 1000×1000 PNG |

Settings are saved to `.env` in the project root.

## License

MIT — see [LICENSE](LICENSE).
