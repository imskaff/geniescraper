/** Runs async jobs with at most `limit` in flight at once; the rest wait their turn in order. */
export class Limiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await job();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

/** Runs async jobs strictly one after another, like the Python app's serialized prefetch: one polite tab at a time. */
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job, job);
    // A failed job must not stall the queue; its caller still sees the failure through `result`.
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Time and waiting behind an interface, so tests need no real pauses. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

/**
 * Runs jobs in the order they arrive, at most `limit` at once, and starts no two jobs closer than `gapMs`. A site read
 * this way sees a few page loads spread out, never a burst. `setLimit` lowers the concurrency (never below 1) when
 * the site starts to push back; jobs already running are left to finish.
 */
export class PoliteQueue {
  private active = 0;
  private nextStart = Number.NEGATIVE_INFINITY;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly gapMs: number,
    private limit = 1,
    private readonly clock: Clock = REAL_CLOCK,
  ) {}

  setLimit(limit: number): void {
    this.limit = Math.max(1, limit);
  }

  get concurrency(): number {
    return this.limit;
  }

  async run<T>(job: () => Promise<T>): Promise<T> {
    while (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      // Reserve the start time before waiting, so jobs that arrive together are spread out, in order.
      const at = Math.max(this.clock.now(), this.nextStart);
      this.nextStart = at + this.gapMs;
      const wait = at - this.clock.now();
      if (wait > 0) await this.clock.sleep(wait);
      return await job();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
