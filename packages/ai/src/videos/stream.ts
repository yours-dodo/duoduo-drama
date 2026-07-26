import { AiRuntimeError } from '../core/errors.js';
import type { VideoGenerationResult } from './output.js';
import type { VideoOperationRef } from './operation-claims.js';
import type { GeneratedVideo, VideoGenerationOutput } from './output.js';

export type VideoGenerationEvent =
  | Readonly<{
      type: 'generation_start';
      sequence: number;
      model: VideoGenerationResult['model'];
      operation?: VideoOperationRef;
    }>
  | Readonly<{
      type: 'generation_progress';
      sequence: number;
      phase?: string;
      progress?: number;
      queuePosition?: number;
      estimatedWaitMs?: number;
      operation?: VideoOperationRef;
    }>
  | Readonly<{
      type: 'generation_preview';
      sequence: number;
      outputIndex: number;
      video: GeneratedVideo;
    }>
  | Readonly<{
      type: 'generation_output';
      sequence: number;
      outputIndex: number;
      output: VideoGenerationOutput;
    }>
  | Readonly<{
      type: 'generation_end';
      sequence: number;
      result: Extract<VideoGenerationResult, { status: 'completed' }>;
    }>
  | Readonly<{
      type: 'generation_error';
      sequence: number;
      result: Extract<
        VideoGenerationResult,
        { status: 'failed' | 'cancelled' }
      >;
    }>
  | Readonly<{
      type: 'generation_detached';
      sequence: number;
      result: Extract<VideoGenerationResult, { status: 'detached' }>;
    }>;

export interface VideoGenerationStream extends AsyncIterable<VideoGenerationEvent> {
  result(): Promise<VideoGenerationResult>;
  abort(reason?: string): void;
  detach(): Promise<VideoOperationRef>;
}

interface Waiter {
  resolve(value: IteratorResult<VideoGenerationEvent>): void;
  reject(error: unknown): void;
}

export class DirectVideoGenerationStream implements VideoGenerationStream {
  private started = false;
  private iteratorTaken = false;
  private observationClosed = false;
  private terminal = false;
  private readonly controller = new AbortController();
  private readonly queue: VideoGenerationEvent[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly resultPromise: Promise<VideoGenerationResult>;
  private resolveResult!: (result: VideoGenerationResult) => void;
  private rejectResult!: (error: unknown) => void;
  private operation?: VideoOperationRef;
  private detachPromise?: Promise<VideoOperationRef>;
  private operationLease?: Readonly<{ release(): void }>;

  constructor(
    private readonly producer: (
      stream: DirectVideoGenerationStream,
    ) => Promise<void>,
    signal?: AbortSignal,
    private readonly onDetach?: (
      stream: DirectVideoGenerationStream,
      operation: VideoOperationRef,
    ) => Promise<void>,
    private readonly onStart?: (
      stream: DirectVideoGenerationStream,
    ) => Readonly<{ release(): void }>,
  ) {
    this.resultPromise = new Promise((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    void this.resultPromise.catch(() => undefined);
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

  async publish(event: VideoGenerationEvent): Promise<void> {
    if (this.terminal || this.observationClosed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value: event });
    else this.queue.push(event);
  }

  async complete(
    result: VideoGenerationResult,
    event: VideoGenerationEvent,
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
    if (event.type !== 'generation_detached') this.releaseOperationLease();
  }

  result(): Promise<VideoGenerationResult> {
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

  setOperation(operation: VideoOperationRef): void {
    if (this.operation && this.operation !== operation)
      throw new AiRuntimeError(
        'VIDEO_PROTOCOL_VIOLATION',
        'protocol',
        'video operation was set more than once',
      );
    this.operation = operation;
  }

  async detach(): Promise<VideoOperationRef> {
    if (!this.operation || !this.onDetach || this.terminal)
      throw new AiRuntimeError(
        'OPERATION_NOT_AVAILABLE',
        'invalid_request',
        'video generation has no active operation to detach',
      );
    if (!this.detachPromise)
      this.detachPromise = (async () => {
        await this.onDetach!(this, this.operation!);
        if (!this.controller.signal.aborted)
          this.controller.abort('video generation detached');
        this.releaseOperationLease();
        return this.operation!;
      })();
    return this.detachPromise;
  }

  [Symbol.asyncIterator](): AsyncIterator<VideoGenerationEvent> {
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
    try {
      this.operationLease = this.onStart?.(this);
    } catch (error) {
      this.fail(error);
      return;
    }
    void this.producer(this)
      .catch((error: unknown) => this.fail(error))
      .finally(() => this.releaseOperationLease());
  }

  private next(): Promise<IteratorResult<VideoGenerationEvent>> {
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

  private fail(error: unknown): void {
    if (this.terminal) return;
    this.terminal = true;
    this.queue.length = 0;
    this.rejectResult(error);
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  private releaseOperationLease(): void {
    this.operationLease?.release();
    this.operationLease = undefined;
  }
}
