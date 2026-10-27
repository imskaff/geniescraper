// Bounded waiting. Every wait ends: on the condition, or at its timeout. Fixed sleeps are avoided because they
// slow every scrape; the observer reacts the moment the page changes, and the poll covers throttled hidden tabs.

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves with the first truthy `probe()` result, or null once `timeoutMs` has passed. */
export function waitFor<T>(
  doc: Document,
  probe: () => T | null | undefined | false,
  timeoutMs: number,
  pollMs: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const first = probe();
    if (first) {
      resolve(first);
      return;
    }

    const stop: (() => void)[] = [];
    const finish = (value: T | null): void => {
      for (const cleanup of stop) cleanup();
      resolve(value);
    };
    const check = (): void => {
      const value = probe();
      if (value) finish(value);
    };

    const observer = new MutationObserver(check);
    observer.observe(doc, { childList: true, subtree: true, attributes: true });
    const poll = setInterval(check, pollMs);
    const deadline = setTimeout(() => {
      finish(null);
    }, timeoutMs);
    stop.push(
      () => {
        observer.disconnect();
      },
      () => {
        clearInterval(poll);
      },
      () => {
        clearTimeout(deadline);
      },
    );
  });
}
