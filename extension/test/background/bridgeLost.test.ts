import { describe, expect, it } from "vitest";
import { PasteService } from "../../src/background/paste";
import { PASTE_KEY, normalisePaste, pauseMessage } from "../../src/core/paste";
import { memoryStore } from "../ui/fakes";
import { fakeBrowser } from "./fakePorts";

describe("a lost link to the desktop app", () => {
  it("pauses a running run with its own reason and message, which survive storage", async () => {
    const browser = fakeBrowser({ geniusTabs: [{ id: 7, active: true }] });
    const session = memoryStore();
    const service = new PasteService(browser.ports, { settings: memoryStore(), session });
    await service.command({ type: "paste-start", title: "S", queue: [["artist", "A"]] });
    await service.command({ type: "paste-auto-start" });
    await service.bridgeLost();
    const state = normalisePaste(session.data.get(PASTE_KEY));
    expect(state.auto).toBe("paused");
    expect(state.pauseReason).toBe("bridge-lost");
    expect(state.message).toBe(pauseMessage("bridge-lost"));
  });

  it("changes nothing when no run is going", async () => {
    const browser = fakeBrowser({ geniusTabs: [{ id: 7, active: true }] });
    const session = memoryStore();
    const service = new PasteService(browser.ports, { settings: memoryStore(), session });
    await service.command({ type: "paste-start", title: "S", queue: [["artist", "A"]] });
    const before = JSON.stringify(session.data.get(PASTE_KEY));
    await service.bridgeLost();
    expect(JSON.stringify(session.data.get(PASTE_KEY))).toBe(before);
  });
});
