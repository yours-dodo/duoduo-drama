import type { StoryArtifactType } from '../../domain/story/story-artifact.js';
import type {
  StoryArtifactContentFormat,
  StoryArtifactVersionSource,
} from '../../domain/story/story-artifact-version.js';
import type { StoryGenerationFailureCode } from '../../domain/story/story-generation-request.js';

export interface StoryGenerationAgentMessage {
  authorType: 'user' | 'agent' | 'system';
  body: string;
}

export interface StoryGenerationAgentArtifactContext {
  id: string;
  type: StoryArtifactType;
  title: string;
  content: string;
  sourceType: StoryArtifactVersionSource;
}

export interface StoryGenerationAgentRequest {
  requestId: string;
  idempotencyKey: string;
  authorization: {
    tenantId: string;
    projectId: string;
    conversationId: string;
  };
  userPrompt: string;
  messages: StoryGenerationAgentMessage[];
  artifacts: StoryGenerationAgentArtifactContext[];
}

export interface StoryGenerationAgentResult {
  artifactType: StoryArtifactType;
  title: string;
  content: string;
  contentFormat: StoryArtifactContentFormat;
  assistantBody: string;
}

export interface AgentGateway {
  generateStory(
    request: StoryGenerationAgentRequest,
  ): Promise<StoryGenerationAgentResult>;
}

export type AgentGatewayFailureCode = StoryGenerationFailureCode;
