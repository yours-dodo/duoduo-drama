export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve(result: IteratorResult<T>): void;
    reject(error: unknown): void;
  }> = [];
  private ended = false;
  private iterated = false;
  private failure: unknown;

  constructor(private readonly maxValues: number) {}

  push(value: T): boolean {
    if (this.ended) return false;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value });
      return true;
    }
    if (this.values.length >= this.maxValues) return false;
    this.values.push(value);
    return true;
  }

  replaceWithTerminal(value: T): void {
    if (this.ended) return;
    this.values.splice(0);
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value });
    else this.values.push(value);
  }

  pushTerminal(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value });
    else this.values.push(value);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0))
      waiter.resolve({ done: true, value: undefined });
  }

  fail(error: unknown): void {
    if (this.ended) return;
    this.failure = error;
    this.values.splice(0);
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.iterated)
      throw new TypeError('Agent task event stream supports one consumer');
    this.iterated = true;

    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined)
          return Promise.resolve({ done: false as const, value });
        if (this.ended)
          return this.failure === undefined
            ? Promise.resolve({ done: true as const, value: undefined })
            : Promise.reject(this.failure);
        return new Promise<IteratorResult<T>>((resolve, reject) =>
          this.waiters.push({ resolve, reject }),
        );
      },
    };
  }
}
