# Géniescraper extension: questions and answers

## How do I use it?

1. Open the side panel from the toolbar button and paste an Apple Music or Spotify album or song link.
2. Pick the tracks and press Get credits.
3. Open the Genius song's Edit Metadata form in a tab and press Start pasting: the extension fills the fields by itself.
   (Step by step fills one field per press of your fill key, F8 by default.)
4. Check the form on Genius, then press Save there yourself. The extension never saves for you.

## A track says "Needs a look". What does that mean?

The read worked, but something it was asked to find is missing.
The words name it: credits, copyright, cover art or YouTube link.
The same item is marked in amber in the track's credits.
Open the track and fix it: a missing YouTube link can be found through the "Find on YouTube" button and pasted into the box under it.
A step you switched off in Settings is never reported as missing.

## It says "YouTube is limiting requests right now"

YouTube refuses a burst of searches from one address.
The extension asks for one track at a time, with your key too, and stops at the first refusal; the tracks it did not get to say "Not checked".
After about 45 seconds it looks again by itself, up to three times, so most of them fill in without you doing anything.
Opening a track also tries again, once, if its lookup found nothing.
For a long album, add your own free YouTube key in Settings (the panel walks you through it): Google's official service does not have this limit, but its free daily allowance covers a limited number of songs (roughly fifty, by our estimate).
You can always use "Find on YouTube" and paste the link yourself.

## "Your free YouTube allowance for today is used up"

That is your own key's daily quota.
It resets at midnight Pacific time. Until then the extension falls back to YouTube's pages, or you can paste links yourself.

## Automatic pasting stopped. Why, and how do I carry on?

The panel says why. It pauses when:

- you click or type in the form (except while it waits for you to choose a name, when it expects you to),
- you press Esc, turn Auto-paste off, press Back, or press the fill key,
- you close the panel,
- a field it needs is not on the form, or the Genius page is reloaded.

Turn Auto-paste back on to carry on from the same step.
If you started it before opening the song's Edit Metadata form, it waits for the form to appear.
It never presses Save.

## Pressing F8 or F7 does nothing

- On many laptops the F-keys need the Fn key held down. Pick another key in Settings if F8 is taken.
- The Genius edit form must be open and focused in a tab, and a paste session must be running (the panel shows "Step 1 of N").
- Chrome uses F7 for caret browsing. The extension suppresses that while pasting, but if F7 still pops up a caret-browsing prompt, choose another Back key in Settings.

## Genius did not pick the name I wanted

When Genius shows no exact match for a name, the text stays typed and you choose from its list yourself.
A close match is never picked for you.
You can turn off "Choose the exact match in Genius's suggestions for me" in Settings if you would rather choose every time.

## The credits look incomplete

Apple Music sometimes loads a page slowly.
Press Back to tracks and read the track again.
If a track really has no credits on Apple Music, none can be read.

## Open on Genius says it found nothing, or several

It only opens a song whose title and artist match exactly (a remix, a live version or a translation page is not the song).
If Genius shows no such song, it may not be on Genius yet, and nothing is opened; if it shows several, they are listed as links so you open the right one yourself.
If it says the page has no Edit Metadata button, you are not signed in to Genius in this browser.
It never saves, and it never reuses a Genius tab that shows something else, because that tab may hold a form you have not saved.

## Why does Chrome ask to read open.spotify.com?

Spotify is a second source, and its host is optional.
The first time you pick a Spotify page the panel explains what will happen, and only your click on Allow makes Chrome show its own prompt.
Géniescraper then opens that page in a hidden window, presses Spotify's own "View credits" button and reads the names and roles in the box that opens.
It only does this for pages you pick, one at a time, and nothing it reads is sent anywhere.
You can refuse, and Apple Music keeps working; you can also remove the access later in `chrome://extensions`.
Until you have allowed it, your open Spotify tabs do not show up in the panel's list, because Chrome hides the address of a tab from an extension that may not read that site.

## What is different about credits from Spotify?

- Spotify's credits box does not show the release date or the ISRC, so the panel says so beside the credits, and those fields are not filled from Spotify.
  A track's page shows only the year; an album page's date is used when it is in English.
- Spotify role names are read in English only. If Spotify shows its page in your language, the roles it cannot match are listed under "About this read" as left out, and you can add them on Genius yourself.
- Roles that Genius has no name for are listed under "About this read" too, instead of being guessed.
- A long album shows only its first tracks on Spotify's page, so the track list marks the rest as "No Spotify page". Open one of those tracks on its own page and read it from there.
- Cover art comes from Apple's catalog or Deezer by title and artist, as for Apple Music.
- If Spotify asks for a captcha, reading from Spotify stops for 15 minutes. Open open.spotify.com, check it works, and try again.

## What leaves my browser?

Only song titles and artist names, to the services you turned on, or to Genius when you press Open on Genius, and nothing to the developer, because there is no server.
See [PRIVACY.md](PRIVACY.md) for the full list.

## How do I report a bug without sharing private data?

Open an issue and use the "Extension bug" form.
Give the public Apple Music link, what you did, the exact words of the message and your browser.
Please leave out:

- your YouTube API key (it starts with `AIza`),
- cookies, tokens or anything from your Genius or Apple account,
- screenshots that show your name, email or account menu.

A song title and an album link are public, so those are fine.

## Where is my data kept?

Settings are in `chrome.storage.sync` (they may sync through your Google account).
Your current album and credits are in memory only and cleared when the browser closes.
Your YouTube key, if you add one, is on this device only.
Removing the extension removes all of it.
