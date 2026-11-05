// Turns the Chrome manifest into the one the Firefox build uses: an event page instead of a service worker, the
// sidebar instead of the side panel, and the extension id and data declaration that addons.mozilla.org requires.
// Pure function, so it is tested on any machine. Background: docs/firefox-support.md.

// TODO(owner, docs/firefox-support.md "AMO submission"): proposal only. The id is permanent once the add-on is
// listed, so the owner picks it before the first upload.
export const GECKO_ID = "geniescraper@imskaff";
export const FIREFOX_MIN_VERSION = "140.0";
// TODO(owner, docs/firefox-support.md "Data declaration"): placeholder. Decide the real types against PRIVACY.md
// (song titles and artists go to Genius, Apple, Spotify, Deezer and YouTube) before the first upload.
export const DATA_COLLECTION = { required: ["none"] };

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
