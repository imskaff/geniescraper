import { afterEach, describe, expect, it, vi } from "vitest";
import { pause } from "../../src/apple/wait";

describe("pause", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits at least the time asked for", async () => {
    const start = performance.now();
    await pause(30);
    expect(performance.now() - start).toBeGreaterThanOrEqual(30);
  });

  it("does not depend on timers, which a hidden tab throttles", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    const start = performance.now();
    await pause(20);
    expect(performance.now() - start).toBeGreaterThanOrEqual(20);
  });

  it("returns at once for no wait", async () => {
    await expect(pause(0)).resolves.toBeUndefined();
  });
});
