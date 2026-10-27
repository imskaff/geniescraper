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
