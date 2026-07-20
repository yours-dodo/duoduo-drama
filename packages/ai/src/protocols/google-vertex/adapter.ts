import { createGoogleStreamingAdapter } from '../google-generative-ai/google-shared.js';

export const googleVertexContract = Object.freeze({
  protocol: 'google-vertex' as const,
  streaming: true,
  terminalOwner: 'runtime' as const,
});

export const googleVertexReplayCodecs = Object.freeze([
  Object.freeze({ id: 'google-thought-signature', version: 1 }),
]);

export const runGoogleVertex = createGoogleStreamingAdapter({
  protocolId: 'google-vertex',
});

export function createGoogleVertexAdapter() {
  return runGoogleVertex;
}
