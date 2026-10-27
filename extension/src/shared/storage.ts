// The slice of chrome.storage the panel uses, behind an interface so tests can fake it.
// Settings go to the synced area; the working session (album, tracks, credits) stays in the session area:
// it survives the panel closing, but never leaves the browser or outlives it.
import { PASTE_KEY, normalisePaste, type PasteState } from "../core/paste";
import { SETTINGS_KEY, normaliseSettings, type Settings } from "./settings";
import { SESSION_KEY, normaliseSession, type Session } from "./session";

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface Stores {
  settings: KeyValueStore;
  session: KeyValueStore;
}

function area(storage: chrome.storage.StorageArea): KeyValueStore {
  return {
    async get(key) {
      const items = await storage.get(key);
      return items[key];
    },
    async set(key, value) {
      await storage.set({ [key]: value });
    },
  };
}

export function chromeStores(): Stores {
  return { settings: area(chrome.storage.sync), session: area(chrome.storage.session) };
}

export async function loadSettings(stores: Stores): Promise<Settings> {
  try {
    return normaliseSettings(await stores.settings.get(SETTINGS_KEY));
  } catch {
    return normaliseSettings(undefined);
  }
}

export async function saveSettings(stores: Stores, settings: Settings): Promise<void> {
  await stores.settings.set(SETTINGS_KEY, settings);
}

export async function loadSession(stores: Stores): Promise<Session> {
  try {
    return normaliseSession(await stores.session.get(SESSION_KEY));
  } catch {
    return normaliseSession(undefined);
  }
}

export async function saveSession(stores: Stores, session: Session): Promise<void> {
  await stores.session.set(SESSION_KEY, session);
}

/** The paste session as the worker last stored it. The worker is its only writer; the panel only reads. */
export async function loadPaste(stores: Stores): Promise<PasteState> {
  try {
    return normalisePaste(await stores.session.get(PASTE_KEY));
  } catch {
    return normalisePaste(undefined);
  }
}
