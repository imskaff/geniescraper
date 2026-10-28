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
