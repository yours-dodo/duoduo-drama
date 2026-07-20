import { runOpenAiResponses } from '../openai-responses/adapter.js';

export const azureOpenAiResponsesContract = Object.freeze({
  protocol: 'azure-openai-responses' as const,
  route: 'responses' as const,
  streaming: true,
  terminalOwner: 'runtime' as const,
});

export const azureOpenAiResponsesReplayCodecs = Object.freeze([
  Object.freeze({ id: 'openai-response-id', version: 1 }),
]);

export const runAzureOpenAiResponses = runOpenAiResponses;

export function createAzureOpenAiResponsesAdapter() {
  return runAzureOpenAiResponses;
}
