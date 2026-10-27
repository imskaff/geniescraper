// Service worker entry point. MV3 workers are ephemeral, so nothing here may rely on in-memory state:
// the message router and the track prefetch queue arrive in later slices, backed by chrome.storage.
export {};
