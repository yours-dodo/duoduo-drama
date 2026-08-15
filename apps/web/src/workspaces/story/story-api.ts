import { requestJson } from '../../lib/server-api/http-client';

export type StoryProjectVisibility = 'team' | 'private';
export type StoryProjectStatus = 'active' | 'archived';
export type StoryCreationMode = 'standard' | 'immersive';
export type StoryArtifactType = 'outline' | 'roles' | 'worldview' | 'story';
export type StoryArtifactStatus = 'active' | 'archived';
export type StoryArtifactContentFormat = 'markdown' | 'text' | 'json';
export type StoryArtifactVersionStatus = 'draft' | 'confirmed' | 'discarded';
export type StoryArtifactVersionSource = 'user' | 'agent' | 'import';

export interface StoryProject {
  id: string;
  tenantId: string | null;
  spaceId: string;
  spaceKind: 'personal' | 'team' | null;
  createdByUserId: string;
  ownerUserId: string;
  title: string;
  coverUrl?: string | null;
  creationMode: StoryCreationMode;
  visibility: StoryProjectVisibility;
  status: StoryProjectStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  collaborator: boolean;
  canEdit: boolean;
  canManageCollaborators: boolean;
}

export interface StoryArtifact {
  id: string;
  tenantId: string | null;
  projectId: string;
  type: StoryArtifactType;
  title: string;
  status: StoryArtifactStatus;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryArtifactVersion {
  id: string;
  tenantId: string | null;
  artifactId: string;
  versionNumber: number;
  content: string;
  contentFormat: StoryArtifactContentFormat;
  status: StoryArtifactVersionStatus;
  sourceType: StoryArtifactVersionSource;
  sourceMessageId: string | null;
  generationRequestId: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface StoryProjectsResponse {
  items: StoryProject[];
  nextCursor: string | null;
}

export interface StoryProjectResponse {
  project: StoryProject;
  modules?: StoryArtifact[];
}

export interface StoryImportJob {
  id: string;
  tenantId: string | null;
  projectId: string;
  createdByUserId: string;
  sourceFileName: string;
  sourceContentType: string;
  sourceByteSize: number;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  failureCode: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryImportJobResponse {
  importJob: StoryImportJob;
}

export interface StoryArtifactsResponse {
  items: StoryArtifact[];
}

export interface StoryArtifactResponse {
  artifact: StoryArtifact;
  currentVersion: StoryArtifactVersion | null;
}

export interface StoryVersionsResponse {
  items: StoryArtifactVersion[];
}

export interface StoryConversation {
  id: string;
  tenantId: string | null;
  projectId: string;
  title: string;
  status: 'active' | 'archived';
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoryConversationResponse {
  conversation: StoryConversation;
}

export interface StoryMessageAppendResponse {
  message: {
    id: string;
    tenantId: string | null;
    conversationId: string;
    authorType: 'user' | 'assistant' | 'system';
    body: string;
    createdAt: string;
  };
  generationRequest: StoryGenerationRequestOutput;
}

export type StoryGenerationPipelineStage =
  | 'queued'
  | 'script'
  | 'images'
  | 'speech'
  | 'video';

export interface StoryGenerationRequestOutput {
  id: string;
  tenantId: string;
  conversationId: string;
  triggerMessageId: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  failureCode: string | null;
  pipelineStage: StoryGenerationPipelineStage | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  agentMessageId: string | null;
  artifactId: string | null;
  artifactVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryGenerationRequestResponse {
  generationRequest: StoryGenerationRequestOutput;
  message: {
    id: string;
    authorType: 'user' | 'assistant' | 'system';
    body: string;
    createdAt: string;
  } | null;
  artifact: StoryArtifact | null;
  artifactVersion: StoryArtifactVersion | null;
}

export interface StoryArtifactMutationResponse {
  artifact: StoryArtifact;
  version: StoryArtifactVersion;
}

export function createIdempotencyKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

export function listStoryProjects(
  teamId: string,
  limit = 50,
): Promise<StoryProjectsResponse> {
  const query = new URLSearchParams({ limit: String(limit) });
  return requestJson<StoryProjectsResponse>(
    `v1/teams/${teamId}/story-projects?${query.toString()}`,
  );
}

export function listPersonalStoryProjects(
  limit = 50,
): Promise<StoryProjectsResponse> {
  const query = new URLSearchParams({ limit: String(limit) });
  return requestJson<StoryProjectsResponse>(
    `v1/me/story-projects?${query.toString()}`,
  );
}

export function createStoryProject(
  teamId: string,
  input: {
    title: string;
    visibility?: StoryProjectVisibility;
    creationMode?: StoryCreationMode;
  },
  idempotencyKey = createIdempotencyKey('create-story-project'),
): Promise<StoryProjectResponse> {
  return sendJson<StoryProjectResponse>(
    `v1/teams/${teamId}/story-projects`,
    'POST',
    {
      title: input.title,
      creationMode: input.creationMode ?? 'standard',
      visibility: input.visibility ?? 'team',
    },
    { 'Idempotency-Key': idempotencyKey },
  );
}

export function createPersonalStoryProject(
  input: { title: string; creationMode?: StoryCreationMode },
  idempotencyKey = createIdempotencyKey('create-personal-story-project'),
): Promise<StoryProjectResponse> {
  return sendJson<StoryProjectResponse>(
    'v1/me/story-projects',
    'POST',
    {
      title: input.title,
      creationMode: input.creationMode ?? 'standard',
    },
    { 'Idempotency-Key': idempotencyKey },
  );
}

export function createStoryImportJob(
  teamId: string,
  projectId: string,
  file: Pick<File, 'name' | 'type' | 'size'>,
  idempotencyKey = createIdempotencyKey('create-story-import-job'),
): Promise<StoryImportJobResponse> {
  return sendJson<StoryImportJobResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/import-jobs`,
    'POST',
    {
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      byteSize: file.size,
    },
    { 'Idempotency-Key': idempotencyKey },
  );
}

export function createPersonalStoryImportJob(
  projectId: string,
  file: Pick<File, 'name' | 'type' | 'size'>,
  idempotencyKey = createIdempotencyKey('create-personal-story-import-job'),
): Promise<StoryImportJobResponse> {
  return sendJson<StoryImportJobResponse>(
    `v1/me/story-projects/${projectId}/import-jobs`,
    'POST',
    {
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      byteSize: file.size,
    },
    { 'Idempotency-Key': idempotencyKey },
  );
}

export function createStoryConversation(
  teamId: string,
  projectId: string,
  input: { title: string },
  idempotencyKey = createIdempotencyKey('create-story-conversation'),
): Promise<StoryConversationResponse> {
  return sendJson<StoryConversationResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/conversations`,
    'POST',
    input,
    { 'Idempotency-Key': idempotencyKey },
  );
}

export function createPersonalStoryConversation(
  projectId: string,
  input: { title: string },
  idempotencyKey = createIdempotencyKey('create-personal-story-conversation'),
): Promise<StoryConversationResponse> {
  return sendJson<StoryConversationResponse>(
    `v1/me/story-projects/${projectId}/conversations`,
    'POST',
    input,
    { 'Idempotency-Key': idempotencyKey },
  );
}

export function appendStoryMessage(
  teamId: string,
  projectId: string,
  conversationId: string,
  body: string,
  idempotencyKey = createIdempotencyKey('append-story-message'),
): Promise<StoryMessageAppendResponse> {
  return sendJson<StoryMessageAppendResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/conversations/${conversationId}/messages`,
    'POST',
    { body },
    { 'Idempotency-Key': idempotencyKey },
  );
}

export function getStoryGenerationRequest(
  teamId: string,
  projectId: string,
  conversationId: string,
  requestId: string,
): Promise<StoryGenerationRequestResponse> {
  return requestJson<StoryGenerationRequestResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/conversations/${conversationId}/generation-requests/${requestId}`,
  );
}

export function retryStoryGeneration(
  teamId: string,
  projectId: string,
  conversationId: string,
  requestId: string,
): Promise<StoryGenerationRequestResponse> {
  return sendJson<StoryGenerationRequestResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/conversations/${conversationId}/generation-requests/${requestId}/retry`,
    'POST',
    {},
);
}

export function appendPersonalStoryMessage(
  projectId: string,
  conversationId: string,
  body: string,
  idempotencyKey = createIdempotencyKey('append-personal-story-message'),
): Promise<StoryMessageAppendResponse> {
  return sendJson<StoryMessageAppendResponse>(
    `v1/me/story-projects/${projectId}/conversations/${conversationId}/messages`,
    'POST',
    { body },
    { 'Idempotency-Key': idempotencyKey },
  );
}

export function getStoryProject(
  teamId: string,
  projectId: string,
): Promise<StoryProjectResponse> {
  return requestJson<StoryProjectResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}`,
  );
}

export function listStoryArtifacts(
  teamId: string,
  projectId: string,
): Promise<StoryArtifactsResponse> {
  return requestJson<StoryArtifactsResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/artifacts`,
  );
}

export function getStoryArtifact(
  teamId: string,
  projectId: string,
  artifactId: string,
): Promise<StoryArtifactResponse> {
  return requestJson<StoryArtifactResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/artifacts/${artifactId}`,
  );
}

export function listStoryVersions(
  teamId: string,
  projectId: string,
  artifactId: string,
): Promise<StoryVersionsResponse> {
  return requestJson<StoryVersionsResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/artifacts/${artifactId}/versions`,
  );
}

export function editStoryDraft(
  teamId: string,
  projectId: string,
  artifactId: string,
  versionId: string,
  input: {
    content: string;
    contentFormat: StoryArtifactContentFormat;
    expectedVersionNumber: number;
  },
): Promise<StoryArtifactMutationResponse> {
  return sendJson<StoryArtifactMutationResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/artifacts/${artifactId}/drafts/${versionId}`,
    'PATCH',
    input,
  );
}

export function confirmStoryDraft(
  teamId: string,
  projectId: string,
  artifactId: string,
  versionId: string,
  expectedVersionNumber: number,
  idempotencyKey = createIdempotencyKey('confirm-story-draft'),
): Promise<StoryArtifactMutationResponse> {
  return sendJson<StoryArtifactMutationResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/artifacts/${artifactId}/drafts/${versionId}/confirm`,
    'POST',
    { expectedVersionNumber },
    { 'Idempotency-Key': idempotencyKey },
  );
}

export function discardStoryDraft(
  teamId: string,
  projectId: string,
  artifactId: string,
  versionId: string,
  expectedVersionNumber: number,
): Promise<StoryArtifactMutationResponse> {
  return sendJson<StoryArtifactMutationResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/artifacts/${artifactId}/drafts/${versionId}/discard`,
    'POST',
    { expectedVersionNumber },
  );
}

function sendJson<T>(
  path: string,
  method: 'PATCH' | 'POST',
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  return requestJson<T>(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
