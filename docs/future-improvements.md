# Future improvements

Things we know are worth doing and have not done. Newest first within each section. Each item says what is wrong, what we measured, and where to start.

## 1. The desktop GUI is slow and probably needs a redesign (reported by the owner)

**Problem.** The desktop app feels very laggy: opening Settings, moving between screens and stepping through a song while pasting all take visible time. The owner's view is that it likely needs a complete redesign, possibly on a different GUI toolkit.

**Measured** (29 October 2026, Windows 10, the real app with sample data, `python -m tools.gui_snapshots` harness; medians of 5 to 15 runs, taken while other tests were running, so treat the absolute numbers as an upper bound; the proportions are the point):

| Action | Time | Widgets on screen |
|---|---|---|
| Open or rebuild the Settings window | about 2.3 s | 281 |
| Full rebuild of the pasting screen | about 1.3 s | 566 |
| Redraw the pasting screen for one step | about 0.28 s (worst 0.67 s) | 566 |
| Credits screen with 48 steps | about 0.66 s | 213 |
| Start screen | about 0.46 s | 88 |

The script that produced these is simple to repeat: time `_show_scrape_screen`, `SettingsWindow._build`, `_show_credits_screen`, `_render_assistant` and `_show_assistant_screen` inside the walk in `tools/gui_snapshots.py`, and count `winfo_children()` recursively.

**Likely causes** (not yet proven by a profiler):
- customtkinter draws every widget on its own canvas, so each widget is expensive to create and to redraw. A screen with hundreds of widgets takes seconds.
- Screens are rebuilt from scratch on change (for example `_show_assistant_screen` and `SettingsWindow._build` destroy and recreate everything), instead of updating the few labels that changed.
- The pasting screen renders one widget group for every one of the 48 or more steps, although only a few are ever visible.

**Where to start (cheap, keeps the toolkit):**
1. Profile first (`cProfile` around `_render_assistant`, and `CTkLabel`/`CTkFrame` construction counts) to confirm the causes.
2. Redraw in place: keep the widgets, change their text and colors, and move the highlight on the step list instead of rebuilding it.
3. Show only the steps near the current one (a window of 10 to 15 rows), not all of them.
4. Build the Settings window once and show or hide it, instead of rebuilding it on open.

**Where to go if that is not enough (a real redesign):**

| Option | For | Against |
|---|---|---|
| PySide6 (Qt) | Fast native widgets, real lists and virtualization, good Windows and macOS support, styling close to the extension's tokens | Larger dependency, a rewrite of every screen, packaging is heavier |
| A local web UI (the app serves a page, the browser shows it) | The extension's panel code and styles could be reused, one look for both, easiest to keep consistent | Needs a browser tab or window; two moving parts |
| Flet / Tauri / Electron | Modern look | Heavy runtimes or a second language; more packaging work |
| Dear PyGui | Very fast | Immediate-mode look, less accessible, fewer standard widgets |

**Recommendation.** Do steps 1 to 4 first and measure again. Because the browser extension is already the main way to paste (the desktop mostly reads credits and drives the extension over the companion link), the desktop could also become a thin window: link, tracks, credits, and a status view of the extension's run. That makes a toolkit change much smaller than it sounds.

## 2. Other known gaps

- **Hotkey fallback cannot see Genius.** Without the extension the desktop pastes blindly: the user must click the field, it cannot skip names already filled in, and it presses Enter on whatever Genius suggests first. Only the extension validates an exact match. The pasting screen says so ("Manual mode"). The only real fix is the extension; reading Genius through the operating system's accessibility tree was considered and rejected as fragile.
- **Edge** has not been tried with the companion link (the origin it sends is unconfirmed).
- **Safari / Mac** has a popup build (`npm run build:safari`) but nothing has been run in Safari; it needs a Mac with Xcode, and an Apple Developer account for anything but personal use.
- **MV3 worker reconnect:** whether the extension's service worker reconnects to the desktop app after Chrome idles it has not been tested; the desktop's 20-second pings keep it awake while connected.
- **Desktop GUI against the live extension** was only tested with a fake bridge and the headless bridge, not by driving the real window with a real extension.
- **YouTube** lookups are best-effort: Google blocks automated traffic after a handful of requests. The extension has an optional YouTube key; the desktop has none.
- **Parallel reads above 1** have not been tried against live Apple Music from the desktop.
- **Chrome Web Store:** the privacy answers changed (open Apple Music page titles and addresses go to the user's own desktop app); re-check the dashboard's data-use answers at submission.
