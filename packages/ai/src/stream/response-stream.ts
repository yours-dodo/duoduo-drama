import { AiRuntimeError, type AiError } from '../core/errors.js';
import type {
  AiResponseStream,
  AiStreamEvent,
  AssistantResponse,
} from '../core/events.js';
import { BoundedObserverQueue } from './bounded-queue.js';

interface QueueWaiter {
  readonly resolve: (result: IteratorResult<AiStreamEvent>) => void;
  readonly reject: (error: unknown) => void;
}

export interface ResponseStreamOptions {
  readonly observerMaxItems?: number;
  readonly observerMaxBytes?: number;
}

export class ResponseStream implements AiResponseStream {
  private started = false;
  private iteratorTaken = false;
  private observationClosed = false;
  private terminalStarted = false;
  private readonly queue: BoundedObserverQueue<AiStreamEvent>;
  private readonly waiters: QueueWaiter[] = [];
  private readonly resultPromise: Promise<AssistantResponse>;
  private resolveResult!: (response: AssistantResponse) => void;
  private rejectResult!: (error: unknown) => void;
  private readonly controller = new AbortController();
  private readonly startProducer: () => Promise<void>;

  constructor(
    startProducer: (stream: ResponseStream) => Promise<void>,
    options: ResponseStreamOptions = {},
  ) {
    this.startProducer = () => startProducer(this);
    this.queue = new BoundedObserverQueue<AiStreamEvent>({
      maxItems: options.observerMaxItems,
      maxBytes: options.observerMaxBytes,
    });
    this.resultPromise = new Promise<AssistantResponse>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    void this.resultPromise.catch(() => undefined);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.startProducer().catch((error: unknown) => {
      this.rejectResult(error);
      this.failIterator(error);
    });
  }

  async publish(event: AiStreamEvent): Promise<void> {
    if (this.terminalStarted || this.observationClosed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: event });
      return;
    }
    await this.queue.push(event);
  }

  async complete(
    response: AssistantResponse,
    terminalEvent: AiStreamEvent,
  ): Promise<void> {
    if (this.terminalStarted) return;
    this.terminalStarted = true;
    if (!this.observationClosed) {
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve({ done: false, value: terminalEvent });
      else await this.queue.push(terminalEvent);
    }
    this.queue.close();
    this.resolveResult(response);
    this.flushDone();
  }

  failIterator(error: unknown): void {
    this.terminalStarted = true;
    this.queue.close();
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  result(): Promise<AssistantResponse> {
    if (!this.iteratorTaken) {
      this.observationClosed = true;
      this.queue.close();
      this.queue.drain();
      for (const waiter of this.waiters.splice(0))
        waiter.resolve({ done: true, value: undefined });
    }
    this.start();
    return this.resultPromise;
  }

  abort(reason = 'stream aborted'): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason);
    this.start();
  }

  [Symbol.asyncIterator](): AsyncIterator<AiStreamEvent> {
    if (this.iteratorTaken)
      throw new AiRuntimeError(
        'STREAM_ALREADY_OBSERVED',
        'invalid_request',
        'a stream can only have one iterator',
      );
    if (this.observationClosed)
      throw new AiRuntimeError(
        'STREAM_OBSERVATION_CLOSED',
        'invalid_request',
        'stream observation is closed',
      );
    this.iteratorTaken = true;
    return {
      next: () => this.next(),
      return: async () => {
        this.closeObservation();
        return { done: true, value: undefined };
      },
    };
  }

  private async next(): Promise<IteratorResult<AiStreamEvent>> {
    this.start();
    const event = this.queue.shift();
    if (event) return { done: false, value: event };
    if (this.terminalStarted || this.observationClosed)
      return { done: true, value: undefined };
    return new Promise<IteratorResult<AiStreamEvent>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private closeObservation(): void {
    if (this.observationClosed) return;
    this.observationClosed = true;
    this.queue.drain();
    this.queue.close();
    for (const waiter of this.waiters.splice(0))
      waiter.resolve({ done: true, value: undefined });
  }

  private flushDone(): void {
    if (this.queue.length > 0) return;
    for (const waiter of this.waiters.splice(0))
      waiter.resolve({ done: true, value: undefined });
  }

  // Kept as a narrow seam for runtime-level unexpected error normalization.
  reject(error: AiError): void {
    this.rejectResult(error);
    this.failIterator(error);
  }
}
