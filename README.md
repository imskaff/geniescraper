<div align="center">
<img src="img/geniescraper.png" alt="Géniescraper logo" width="400">

🧩 **A browser extension is in development:** Géniescraper for Chrome, Edge and Safari, on Windows and macOS.

# Géniescraper

**Géniescraper** is a Python-based tool that bridges Apple Music credits and Genius.com metadata entry. It uses stealth browser automation to extract songwriters, producers, roles, copyrights, and cover art, then provides a hotkey-driven GUI assistant to paste everything directly into Genius - 100% in accordance with the guidelines.

</div>

## Features

- ⚡ **Fast**: about 5 seconds from link to credits per track, with the next tracks of an album scraped in the background while you paste.
- 🕵️ **Accurate Extraction**: Playwright with stealth patches reads songwriters, producers, every additional role and the ℗ / © lines from Apple Music albums and songs.
- 🖼️ **Exact Cover Art**: the 1000×1000 PNG of the exact release you opened, looked up by its Apple Music catalog ID.
- ▶️ **Official YouTube Link**: the artist's official music video, or the official audio when there is no video.
- ⌨️ **Hotkey Assistant**: press `F8` to paste each field into Genius and `F7` to go back; Back and Skip buttons and a clickable step list work with the mouse too.
- 🤖 **Auto-Tab and Auto-Confirm**: moves between Genius fields and picks the autocomplete suggestion for you, so you rarely touch the keyboard. Both can be switched on or off while pasting.
- ⚙️ **Settings Everywhere**: a Settings window over any screen; every change applies and saves immediately and is shared by every copy of the app.

## Installation

### Prerequisites
- **Windows**
- **Python 3.10+**
- **[uv](https://docs.astral.sh/uv/)** (`pip install uv`)

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/imskaff/geniescraper.git
   cd geniescraper
   ```

2. **Install dependencies** (creates `.venv` from the locked versions in `uv.lock`):
   ```bash
   uv sync
   ```
   Without uv, `pip install -r requirements.txt` also works, with unpinned versions.

3. **Install the Playwright browser:**
   ```bash
   uv run playwright install chromium
   ```

## Usage

```bash
uv run python gui_main.py
```

1. **Link** - Paste an Apple Music album or song link and click **Scrape**.
   The app tells you right away if the link is not one it can read.
   Album links are best, because they include the copyright lines (℗ and ©).
2. **Tracks** - For an album, tick the songs to paste, or choose all of them.
3. **Review** - Check the credits, copyright lines, YouTube link and cover art that were found, then click **Start pasting** (or press **F8**).
4. **Paste** - Open the song's edit page on Genius, click **Written By**, and follow the on-screen instruction for each step:
   - Press **F8** to paste the current value and move on.
   - Press **F7** or click **Back** to go back one step.
   - Click **Skip** for a field that is already filled on Genius.
   - Click any step in the list to jump to it.
   - Press **Esc** to end pasting for the song.

**⚙ Settings** is on every screen, including while you paste, and every change applies and saves immediately.
Auto-tab and Auto-confirm can also be switched on or off from the pasting screen.

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

Open **⚙ Settings** from any screen:

| Setting | Default | Description |
|---------|---------|-------------|
| Hotkey (Next) | F8 | Paste current field and advance |
| Hotkey (Back) | F7 | Step back one field |
| Auto-confirm | On | Press Enter after paste to confirm autocomplete |
| Autocomplete wait | 0.6 s | How long to wait for Genius's suggestions before confirming |
| Auto-tab | Off | Automatically Tab between Genius fields |
| Compact mode | Off | Hide queue list and shrink the window |
| Always on top | On | Keep the window above the browser |
| Auto-start assistant | Off | Start automatically after a countdown |
| Auto-start delay | 15 s | Seconds before auto-start fires |
| Scrape core credits | On | Songwriters and producers |
| Scrape additional credits | On | All other roles |
| Scrape copyright | On | ℗ and © |
| Scrape YouTube | On | YouTube video/MV link |
| Scrape cover art | On | Album cover at 1000×1000 PNG |

Settings are saved per user in `%APPDATA%\Geniescraper\settings.env`, so every copy of the app shares them.
A `.env` in the project root from older versions is still read until the first save.

## Development

Install the git hooks once per clone (all worktrees of a clone share them):

```bash
uv run pre-commit install
```

Every commit then runs ruff check, ruff format --check, basedpyright and the offline `pytest` suite, and for changes under `extension/` also its lint, type check, tests and build, the same checks CI runs on each push and pull request.
The offline suite includes the fixture parsers, so run `uv run playwright install chromium` first.
Never skip the hooks with `--no-verify`; fix the failure instead.
CI (`.github/workflows/ci.yml`, `windows-latest`) runs the same checks on every push and pull request; the live tests run weekly and on manual dispatch, so Apple Music markup changes show up without blocking pushes.

```bash
uv run ruff check . && uv run ruff format --check .
```

```bash
uv run basedpyright
```

```bash
uv run pytest
```

```bash
uv run pytest -m live
```

```bash
uv run python -m bench.run
```

- `basedpyright` type checks the project in `standard` mode (configured in `pyproject.toml`).
  Known errors in `gui/app.py` are recorded in `.basedpyright/baseline.json`, so only new errors fail; fixed ones drop out of the baseline automatically on the next run.
  Never regenerate the baseline (`--writebaseline`) to hide a new error; fix it instead.
- `uv run pytest` runs the fast offline suite: unit tests, the real parsers against saved Apple Music HTML in `tests/fixtures/`, and the lookups against saved responses.
- `-m live` runs the full scrape flow against live Apple Music and compares it with the hand-reviewed expectations in `tests/golden/`.
- `bench.run` measures latency, accuracy and run-to-run stability over the cases in `bench/cases.json`.
- `uv run python -m bench.capture` refreshes fixtures when Apple changes its markup; it never overwrites a golden file.
- `uv run python -m bench.lookups` measures the YouTube and cover art lookups alone: accuracy against the hand-verified videos in `tests/golden/youtube.json` and the golden cover artwork, plus latency.
- `uv run python -m bench.capture_lookups` refreshes the saved YouTube, Deezer and iTunes responses in `tests/fixtures/lookups/` that the offline lookup tests replay.

### Browser extension

The Chrome extension lives in `extension/` (TypeScript, built with esbuild, tested with Vitest); see [docs/extension-plan.md](docs/extension-plan.md) for the design and slices.
It needs Node 20 or newer and is installed from the lockfile:

```bash
cd extension && npm ci && npm run check
```

`npm run check` runs Prettier (`npm run format` fixes), ESLint, `tsc`, Vitest and the build; `dist/` is the unpacked extension.
`extension/data/roles.json` and `extension/test/vectors.json` are generated from the Python code and must never be edited by hand:

```bash
uv run python -m tools.export_roles && uv run python -m tools.export_vectors
```

A Python test fails when either file is stale, so run both after changing `scraper/roles.py`, `scraper/models.py`, `scraper/apple_music.py`, `scraper/deezer.py`, `scraper/text.py` or `assistant/flow.py`.

`npm run live:hidden-tab -- --chrome <path to Chromium>` is an opt-in live check against Apple Music that the extension can read song pages in a genuinely hidden tab; run `npm run build` first, and find a Chromium with `uv run python -c "from playwright.sync_api import sync_playwright as s; p = s().start(); print(p.chromium.executable_path); p.stop()"`.

## License

MIT - see [LICENSE](LICENSE).
