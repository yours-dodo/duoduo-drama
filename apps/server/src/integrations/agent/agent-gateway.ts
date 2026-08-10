import type { StoryGenerationFailureCode } from '../../domain/story/story-generation-request.js';
import type {
  AgentGateway,
  StoryGenerationAgentRequest,
  StoryGenerationAgentResult,
} from './agent-contracts.js';

export const AGENT_GATEWAY = Symbol('AGENT_GATEWAY');

export class AgentGatewayError extends Error {
  constructor(readonly failureCode: StoryGenerationFailureCode) {
    super('Story Agent gateway failed');
    this.name = 'AgentGatewayError';
  }
}

export type {
  AgentGateway,
  StoryGenerationAgentRequest,
  StoryGenerationAgentResult,
};
