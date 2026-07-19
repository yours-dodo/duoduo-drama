export interface BoundedQueueOptions<T> {
  readonly maxItems?: number;
  readonly maxBytes?: number;
  readonly sizeOf?: (value: T) => number;
}

interface PushWaiter<T> {
  readonly value: T;
  readonly bytes: number;
  readonly resolve: (accepted: boolean) => void;
}

/** A FIFO queue whose writers wait instead of dropping or reordering events. */
export class BoundedObserverQueue<T> {
  private readonly values: { value: T; bytes: number }[] = [];
  private readonly writers: PushWaiter<T>[] = [];
  private bytes = 0;
  private closed = false;
  private readonly maxItems: number;
  private readonly maxBytes: number;
  private readonly sizeOf: (value: T) => number;

  constructor(options: BoundedQueueOptions<T> = {}) {
    this.maxItems = options.maxItems ?? 256;
    this.maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
    this.sizeOf = options.sizeOf ?? defaultSizeOf;
    if (this.maxItems < 1 || this.maxBytes < 1)
      throw new RangeError('bounded queue limits must be positive');
  }

  get length(): number {
    return this.values.length;
  }

  get pendingBytes(): number {
    return this.bytes;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async push(value: T): Promise<boolean> {
    if (this.closed) return false;
    const bytes = Math.max(1, this.sizeOf(value));
    if (bytes > this.maxBytes)
      throw new RangeError('queue item exceeds maxBytes');
    if (this.canFit(bytes)) {
      this.enqueue(value, bytes);
      return true;
    }
    return new Promise<boolean>((resolve) => {
      this.writers.push({ value, bytes, resolve });
    });
  }

  shift(): T | undefined {
    const entry = this.values.shift();
    if (!entry) return undefined;
    this.bytes -= entry.bytes;
    this.admitWriters();
    return entry.value;
  }

  drain(): void {
    this.values.splice(0, this.values.length);
    this.bytes = 0;
    this.admitWriters();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const writer of this.writers.splice(0)) writer.resolve(false);
  }

  private canFit(bytes: number): boolean {
    return (
      this.values.length < this.maxItems && this.bytes + bytes <= this.maxBytes
    );
  }

  private enqueue(value: T, bytes: number): void {
    this.values.push({ value, bytes });
    this.bytes += bytes;
  }

  private admitWriters(): void {
    if (this.closed) {
      for (const writer of this.writers.splice(0)) writer.resolve(false);
      return;
    }
    while (this.writers.length > 0) {
      const next = this.writers[0]!;
      if (!this.canFit(next.bytes)) break;
      this.writers.shift();
      this.enqueue(next.value, next.bytes);
      next.resolve(true);
    }
  }
}

function defaultSizeOf(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 1;
  }
}
