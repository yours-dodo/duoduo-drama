export interface EventStream<T> extends AsyncIterable<T> {
  publish(value: T): void;
  close(): void;
}
