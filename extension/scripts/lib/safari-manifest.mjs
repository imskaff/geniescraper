// Turns the Chrome manifest into the one the Safari build uses: no side panel, a toolbar popup in its place.
// Pure function, so it is tested on any machine; the Mac-only converter step comes after it.

/** @param {Record<string, any>} chrome the Chrome/Edge manifest */
export function toSafariManifest(chrome) {
  const panel = chrome.side_panel?.default_path;
  if (typeof panel !== "string")
    throw new Error("The Chrome manifest has no side_panel.default_path to turn into a popup.");
  const manifest = JSON.parse(JSON.stringify(chrome));
  delete manifest.side_panel;
  delete manifest.minimum_chrome_version;
  manifest.permissions = (manifest.permissions ?? []).filter((name) => name !== "sidePanel");
  manifest.action = { ...manifest.action, default_popup: panel };
  return manifest;
}
