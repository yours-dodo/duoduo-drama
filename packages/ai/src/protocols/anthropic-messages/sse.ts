export type { ServerSentEvent } from '../../transport/sse.js';

import { parseServerSentEvents as parseTransportServerSentEvents } from '../../transport/sse.js';

export function parseServerSentEvents(
  body: AsyncIterable<Uint8Array>,
  maxFrameBytes = 1024 * 1024,
) {
  return parseTransportServerSentEvents(
    body,
    maxFrameBytes,
    'ANTHROPIC_INVALID_SSE',
  );
}
