import type { VideoGenerationEvent } from './stream.js';
import type { VideoOperationRef } from './operation-claims.js';
import type { VideoProtocolProgressEvent } from './contracts.js';

export function projectVideoProtocolEvent(
  event: VideoProtocolProgressEvent,
  sequence: number,
  operation?: VideoOperationRef,
): VideoGenerationEvent {
  if (event.type === 'generation_progress')
    return Object.freeze({
      ...event,
      sequence,
      ...(operation ? { operation } : {}),
    });
  return Object.freeze({ ...event, sequence });
}
