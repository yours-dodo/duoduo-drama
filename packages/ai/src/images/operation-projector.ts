import type { ImageGenerationEvent } from './stream.js';
import type { ImageOperationRef } from './operation-claims.js';
import type { ImageProtocolProgressEvent } from './contracts.js';

export function projectImageProtocolEvent(
  event: ImageProtocolProgressEvent,
  sequence: number,
  operation?: ImageOperationRef,
): ImageGenerationEvent {
  if (event.type === 'generation_progress')
    return Object.freeze({
      ...event,
      sequence,
      ...(operation ? { operation } : {}),
    });
  return Object.freeze({ ...event, sequence });
}
