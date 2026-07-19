import type {
  AiResponseStream,
  AiStreamEvent,
  AssistantResponse,
} from '../core/events.js';

export interface CollectedResponseStream {
  readonly events: readonly AiStreamEvent[];
  readonly response: AssistantResponse;
}

export async function collectResponseStream(
  stream: AiResponseStream,
): Promise<CollectedResponseStream> {
  const events: AiStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return { events: Object.freeze(events), response: await stream.result() };
}

export function assertStreamEventTypes(
  events: readonly AiStreamEvent[],
  expected: readonly AiStreamEvent['type'][],
): void {
  const actual = events.map((event) => event.type);
  if (
    actual.length !== expected.length ||
    actual.some((type, index) => type !== expected[index])
  )
    throw new Error(`unexpected stream events: ${actual.join(', ')}`);
}

export function assertSingleTerminal(events: readonly AiStreamEvent[]): void {
  const terminals = events.filter(
    (event) => event.type === 'response_end' || event.type === 'response_error',
  );
  if (terminals.length !== 1)
    throw new Error(
      `expected one terminal event, received ${terminals.length}`,
    );
  if (events.at(-1) !== terminals[0])
    throw new Error('terminal event must be the final stream event');
}

export function assertResponseStart(events: readonly AiStreamEvent[]): void {
  if (events[0]?.type !== 'response_start')
    throw new Error('response_start must be the first stream event');
  if (events.filter((event) => event.type === 'response_start').length !== 1)
    throw new Error('response_start must occur exactly once');
}
