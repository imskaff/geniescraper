// Turns the Chrome manifest into the one the Firefox build uses: an event page instead of a service worker, the
// sidebar instead of the side panel, and the extension id and data declaration that addons.mozilla.org requires.
// Pure function, so it is tested on any machine. Background: docs/firefox-support.md.

// The extension id. Approved by the owner on 2026-11-05. It can never change once the add-on is published on
// addons.mozilla.org: a different id is a different add-on, so users would lose their settings and updates.
export const GECKO_ID = "geniescraper@imskaff";
export const FIREFOX_MIN_VERSION = "140.0";
// What the extension transmits, in Mozilla's words (docs/firefox-support.md "Data declaration", extension/PRIVACY.md).
// Song titles and artist names read from the page the user is on go to Genius, iTunes and Spotify in the core flow
// (and to Deezer and YouTube when the user turns those on): that is "websiteContent". The one other thing that leaves
// the browser is the user's own YouTube key, sent to Google only if they add one: optional "authenticationInfo",
// requested when the key is saved (see permissionSet in src/lookups/http.ts).
export const DATA_COLLECTION = { required: ["websiteContent"], optional: ["authenticationInfo"] };

/** @param {Record<string, any>} chrome the Chrome/Edge manifest */
export function toFirefoxManifest(chrome) {
  const panel = chrome.side_panel?.default_path;
  const worker = chrome.background?.service_worker;
  if (typeof panel !== "string") throw new Error("The Chrome manifest has no side_panel.default_path for the sidebar.");
  if (typeof worker !== "string")
    throw new Error("The Chrome manifest has no background.service_worker to turn into an event page.");
  const manifest = JSON.parse(JSON.stringify(chrome));
  delete manifest.side_panel;
  delete manifest.minimum_chrome_version;
  manifest.permissions = (manifest.permissions ?? []).filter((name) => name !== "sidePanel");
  manifest.background = { scripts: [worker] };
  manifest.sidebar_action = {
    default_panel: panel,
    default_title: manifest.action?.default_title ?? manifest.name,
    default_icon: manifest.action?.default_icon,
  };
  manifest.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: FIREFOX_MIN_VERSION,
      data_collection_permissions: JSON.parse(JSON.stringify(DATA_COLLECTION)),
    },
  };
  return manifest;
}
