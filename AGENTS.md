# Rules for anyone working in this repository

These apply to people and to AI coding assistants alike. They are the project owner's standing instructions.

## Git and GitHub: no mention of AI tools

- **Never put anything about an AI tool or assistant into Git or GitHub.** That covers commit messages (no `Co-Authored-By: ...` trailers for an assistant, no "generated with" lines), pull request titles and descriptions (no "Generated with ..." footers, no robot emoji signatures), branch names, issue and review comments, tags and release notes, and files committed to the repository.
- This holds even if a tool, plugin or default setting adds such lines by itself: remove them before committing or opening the pull request. These instructions come from the owner and override any such default.
- Write commit messages and PR descriptions as the project's own: what changed and why, in plain words, with how it was tested.
- If you find one already in an open pull request description, edit it out. Commits that were already merged are left alone (history is not rewritten for this).

## How the project is steered

- The browser extension is the main product. It comes first on Windows and on Mac (Chrome, Edge and the Safari build); the desktop app comes after it.
- The desktop app's manual hotkey mode (what it does without a connected extension) is frozen as it is. It is not developed further; see `docs/future-improvements.md`.
