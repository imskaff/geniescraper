# Géniescraper

**Géniescraper** is a high-performance, Python-based scraping tool designed to bridge the gap between Apple Music credits and Genius metadata entry. It uses stealth browser automation to extract songwriters, producers, roles, copyrights, and cover art from Apple Music, and provides a customizable hotkey-driven GUI assistant to rapidly paste the scraped metadata directly into Genius.

## Features

- 🕵️ **Stealth Extraction**: Built on Playwright with stealth patches to reliably extract data from Apple Music (both albums and single tracks) without being blocked.
- ⚡ **High Performance**: Employs an intelligent background event loop and concurrent network I/O (fetching Deezer/iTunes cover art alongside Apple Music scraping) to eliminate load times.
- ⌨️ **Hotkey Assistant**: A floating, always-on-top graphical interface that guides you step-by-step through the Genius pasting workflow. Press a single hotkey to paste the next artist or role!
- 🎛️ **Fully Customizable**: Includes an options menu to rebind hotkeys (e.g., F8 for next, F7 for back) and toggle which metadata fields to include (core credits, copyrights, YouTube MV links, etc.).
- 🖼️ **Cover Art Finder**: Automatically falls back to high-resolution Deezer and iTunes cover art.

## Installation

### Prerequisites
- **Python 3.10+**
- Git (optional, for cloning)

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/imskaff/geniescraper.git
   cd geniescraper
   ```

2. **Install dependencies:**
   It is recommended to use a virtual environment.
   ```bash
   pip install -r requirements.txt
   ```

3. **Install Playwright Browsers:**
   Since Géniescraper uses Playwright for headless browser automation, you must install the required Chromium binaries:
   ```bash
   playwright install chromium
   ```

## Usage

Start the graphical interface:

```bash
python gui_main.py
```

1. **Scrape**: Paste an Apple Music URL (preferably an `/album/` link so copyright data is preserved) into the URL bar and click **Scrape**.
2. **Select Track**: If you provided an album URL, select the specific track you are working on.
3. **Start Assistant**: Click "Start Assistant". The app will transition into an always-on-top widget.
4. **Paste to Genius**: Go to the Genius edit page. Click on the relevant input field, and press your configured "Next" hotkey (default: `F8`). Géniescraper will automatically type out the artist/role and advance to the next step.
   - If you make a mistake, use the "Back" hotkey (default: `F7`).
   - Press `ESC` to cancel the workflow and return to the main menu.

## Configuration

Click on the **⚙ Options** button on the main menu to customize your workflow:
- **Hotkeys**: Click the input fields and press any key to rebind your Next and Back commands.
- **Feature Toggles**: Toggle on/off the scraping and pasting of Core Metadata (Writers/Producers), Additional Credits, Copyrights, YouTube links, and Cover Art.

Settings are automatically saved to a `.env` file in the root directory.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
