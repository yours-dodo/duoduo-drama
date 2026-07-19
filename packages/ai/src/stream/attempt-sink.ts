import type { ProtocolContentEvent } from '../core/events.js';
import type { ProtocolEventSink } from '../runtime/registry.js';

export interface AttemptSinkOptions {
  readonly onPublish: (event: ProtocolContentEvent) => Promise<void>;
  readonly onLateEvent?: (event: ProtocolContentEvent) => void;
}

/** Provider-local sink. It serializes writes and seals before terminal aggregation. */
export class AttemptLocalSink implements ProtocolEventSink {
  private open = true;
  private tail: Promise<void> = Promise.resolve();
  private publishError: unknown;

  constructor(private readonly options: AttemptSinkOptions) {}

  get isOpen(): boolean {
    return this.open;
  }

  publish(event: ProtocolContentEvent): Promise<void> {
    if (!this.open) {
      this.options.onLateEvent?.(event);
      return Promise.resolve();
    }
    const operation = this.tail.then(() => this.options.onPublish(event));
    this.tail = operation.then(
      () => undefined,
      (error: unknown) => {
        this.publishError ??= error;
      },
    );
    return operation;
  }

  async close(): Promise<unknown | undefined> {
    this.open = false;
    await this.tail;
    return this.publishError;
  }
}
