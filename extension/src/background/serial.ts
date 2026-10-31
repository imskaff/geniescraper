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

/** Runs jobs one at a time with at least `gapMs` between the end of one and the start of the next. */
export class PoliteQueue {
  private readonly serial = new Serial();
  private lastEnd = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly gapMs: number,
    private readonly clock: Clock = REAL_CLOCK,
  ) {}

  run<T>(job: () => Promise<T>): Promise<T> {
    return this.serial.run(async () => {
      const wait = this.lastEnd + this.gapMs - this.clock.now();
      if (wait > 0) await this.clock.sleep(wait);
      try {
        return await job();
      } finally {
        this.lastEnd = this.clock.now();
      }
    });
  }
}
