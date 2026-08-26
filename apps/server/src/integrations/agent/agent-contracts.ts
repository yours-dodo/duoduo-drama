import type { StoryArtifactType } from '../../domain/story/story-artifact.js';
import type {
  StoryArtifactContentFormat,
  StoryArtifactVersionSource,
} from '../../domain/story/story-artifact-version.js';
import type { StoryGenerationFailureCode } from '../../domain/story/story-generation-request.js';

export type { StoryGenerationFailureCode } from '../../domain/story/story-generation-request.js';

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
    tenantId: string | null;
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

export type StoryGenerationStage =
  'queued' | 'script' | 'images' | 'speech' | 'video';

export type StoryTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface StoryTaskRef {
  taskId: string;
  status: StoryTaskStatus;
  stage: StoryGenerationStage;
}

export interface StoryTaskSnapshot extends StoryTaskRef {
  result?: StoryGenerationAgentResult;
  error?: string;
  failureCode?: StoryGenerationFailureCode;
}

export type StoryProjectEra = '现代' | '古代';

export interface StoryTagGenerationRequest {
  title: string;
  description: string;
}

export interface StoryTagGenerationResult {
  era: StoryProjectEra;
  tags: string[];
}

export interface AgentGateway {
  startStory(request: StoryGenerationAgentRequest): Promise<StoryTaskRef>;
  getStoryTask(taskId: string): Promise<StoryTaskSnapshot>;
  summarizeStoryTags(
    request: StoryTagGenerationRequest,
  ): Promise<StoryTagGenerationResult>;
}

export type AgentGatewayFailureCode = StoryGenerationFailureCode;
