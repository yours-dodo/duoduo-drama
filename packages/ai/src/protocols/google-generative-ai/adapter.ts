import { createGoogleStreamingAdapter } from './google-shared.js';

export const googleGenerativeAiContract = Object.freeze({
  protocol: 'google-generative-ai' as const,
  streaming: true,
  terminalOwner: 'runtime' as const,
});

export const googleGenerativeAiReplayCodecs = Object.freeze([
  Object.freeze({ id: 'google-thought-signature', version: 1 }),
]);

export const runGoogleGenerativeAi = createGoogleStreamingAdapter({
  protocolId: 'google-generative-ai',
});
