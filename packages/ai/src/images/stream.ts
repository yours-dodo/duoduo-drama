import { AiRuntimeError } from '../core/errors.js';
import type { ImageGenerationResult } from './output.js';
import type { ImageOperationRef } from './operation-claims.js';
import type { GeneratedImage, ImageGenerationOutput } from './output.js';

export type ImageGenerationEvent =
  | Readonly<{
      type: 'generation_start';
      sequence: number;
      model: ImageGenerationResult['model'];
      operation?: ImageOperationRef;
    }>
  | Readonly<{
      type: 'generation_progress';
      sequence: number;
      phase?: string;
      progress?: number;
      queuePosition?: number;
      estimatedWaitMs?: number;
      operation?: ImageOperationRef;
    }>
  | Readonly<{
      type: 'generation_preview';
      sequence: number;
      outputIndex: number;
      image: GeneratedImage;
    }>
  | Readonly<{
      type: 'generation_output';
      sequence: number;
      outputIndex: number;
      output: ImageGenerationOutput;
    }>
  | Readonly<{
      type: 'generation_end';
      sequence: number;
      result: Extract<ImageGenerationResult, { status: 'completed' }>;
    }>
  | Readonly<{
      type: 'generation_error';
      sequence: number;
      result: Extract<
        ImageGenerationResult,
        { status: 'failed' | 'cancelled' }
      >;
    }>
  | Readonly<{
      type: 'generation_detached';
      sequence: number;
      result: Extract<ImageGenerationResult, { status: 'detached' }>;
    }>;

export interface ImageGenerationStream extends AsyncIterable<ImageGenerationEvent> {
  result(): Promise<ImageGenerationResult>;
  abort(reason?: string): void;
  detach(): Promise<ImageOperationRef>;
}

interface Waiter {
  resolve(value: IteratorResult<ImageGenerationEvent>): void;
  reject(error: unknown): void;
}

export class DirectImageGenerationStream implements ImageGenerationStream {
  private started = false;
  private iteratorTaken = false;
  private observationClosed = false;
  private terminal = false;
  private readonly controller = new AbortController();
  private readonly queue: ImageGenerationEvent[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly resultPromise: Promise<ImageGenerationResult>;
  private resolveResult!: (result: ImageGenerationResult) => void;
  private operation?: ImageOperationRef;
  private detachPromise?: Promise<ImageOperationRef>;

  constructor(
    private readonly producer: (
      stream: DirectImageGenerationStream,
    ) => Promise<void>,
    signal?: AbortSignal,
    private readonly onDetach?: (
      stream: DirectImageGenerationStream,
      operation: ImageOperationRef,
    ) => Promise<void>,
  ) {
    this.resultPromise = new Promise((resolve) => {
      this.resolveResult = resolve;
    });
    if (signal) {
      if (signal.aborted) this.controller.abort(signal.reason);
      else
        signal.addEventListener(
          'abort',
          () => this.abort(String(signal.reason ?? 'aborted')),
          { once: true },
        );
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  async publish(event: ImageGenerationEvent): Promise<void> {
    if (this.terminal || this.observationClosed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value: event });
    else this.queue.push(event);
  }

  async complete(
    result: ImageGenerationResult,
    event: ImageGenerationEvent,
  ): Promise<void> {
    if (this.terminal) return;
    this.terminal = true;
    if (!this.observationClosed) {
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve({ done: false, value: event });
      else this.queue.push(event);
    }
    this.resolveResult(result);
    this.flushDone();
  }

  result(): Promise<ImageGenerationResult> {
    if (!this.iteratorTaken) {
      this.observationClosed = true;
      this.queue.length = 0;
      for (const waiter of this.waiters.splice(0))
        waiter.resolve({ done: true, value: undefined });
    }
    this.start();
    return this.resultPromise;
  }

  abort(reason = 'generation aborted'): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason);
    this.start();
  }

  setOperation(operation: ImageOperationRef): void {
    if (this.operation && this.operation !== operation)
      throw new AiRuntimeError(
        'IMAGE_PROTOCOL_VIOLATION',
        'protocol',
        'image operation was set more than once',
      );
    this.operation = operation;
  }

  async detach(): Promise<ImageOperationRef> {
    if (!this.operation || !this.onDetach || this.terminal)
      throw new AiRuntimeError(
        'OPERATION_NOT_AVAILABLE',
        'invalid_request',
        'image generation has no active operation to detach',
      );
    if (!this.detachPromise)
      this.detachPromise = (async () => {
        await this.onDetach!(this, this.operation!);
        return this.operation!;
      })();
    return this.detachPromise;
  }

  [Symbol.asyncIterator](): AsyncIterator<ImageGenerationEvent> {
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
        this.observationClosed = true;
        this.queue.length = 0;
        for (const waiter of this.waiters.splice(0))
          waiter.resolve({ done: true, value: undefined });
        return { done: true, value: undefined };
      },
    };
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    void this.producer(this).catch(() => undefined);
  }

  private next(): Promise<IteratorResult<ImageGenerationEvent>> {
    this.start();
    const event = this.queue.shift();
    if (event) return Promise.resolve({ done: false, value: event });
    if (this.terminal || this.observationClosed)
      return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) =>
      this.waiters.push({ resolve, reject }),
    );
  }

  private flushDone(): void {
    if (this.queue.length > 0) return;
    for (const waiter of this.waiters.splice(0))
      waiter.resolve({ done: true, value: undefined });
  }
}
