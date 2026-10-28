# Géniescraper extension: questions and answers

## How do I use it?

1. Open the side panel from the toolbar button and paste an Apple Music album or song link.
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
The extension asks for one track at a time and stops at the first refusal; the tracks it did not get to say "Not checked".
Wait a minute and open the track to try again.
For a long album, add your own free YouTube key in Settings (the panel walks you through it): Google's official service does not have this limit, but its free daily allowance covers a limited number of songs (roughly fifty, by our estimate).
You can always use "Find on YouTube" and paste the link yourself.

## "Your free YouTube allowance for today is used up"

That is your own key's daily quota.
It resets at midnight Pacific time. Until then the extension falls back to YouTube's pages, or you can paste links yourself.

## Automatic pasting stopped. Why, and how do I carry on?

The panel says why. It pauses when:

- you click or type in the form (except while it waits for you to choose a name, when it expects you to),
- you press Esc, Pause or Back, or press the fill key,
- you close the panel,
- a field it needs is not on the form, or the Genius page is reloaded.

Press Resume to carry on from the same step.
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

## What leaves my browser?

Only song titles and artist names, to the services you turned on, and nothing to the developer, because there is no server.
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
