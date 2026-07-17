// Pull-based async queue shared by both agent drivers (agent-sessions.ts,
// adk-sessions.ts): the driver consumes it as a long-lived AsyncIterable
// while later code pushes follow-up user messages (chat replies, retries,
// "Continue.") into the same running session instead of starting a fresh
// run per message.
export class AsyncQueue<T> implements AsyncIterable<T> {
  #buffer: T[] = [];
  #waiters: ((item: T | null) => void)[] = [];
  #closed = false;

  push(item: T): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter(item);
    else this.#buffer.push(item);
  }

  close(): void {
    this.#closed = true;
    while (this.#waiters.length) this.#waiters.shift()!(null);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.#buffer.length) {
        yield this.#buffer.shift()!;
        continue;
      }
      if (this.#closed) return;
      const item = await new Promise<T | null>((resolve) => this.#waiters.push(resolve));
      if (item === null) return;
      yield item;
    }
  }
}
