import { requestJson } from '../../lib/server-api/http-client';

export type StoryProjectVisibility = 'team' | 'private';
export type StoryProjectStatus = 'active' | 'archived';
export type StoryArtifactType =
  'idea' | 'world_setting' | 'character' | 'outline' | 'script';
export type StoryArtifactStatus = 'active' | 'archived';
export type StoryArtifactContentFormat = 'markdown' | 'text';
export type StoryArtifactVersionStatus = 'draft' | 'confirmed' | 'discarded';
export type StoryArtifactVersionSource = 'user' | 'agent' | 'import';

export interface StoryProject {
  id: string;
  tenantId: string;
  createdByUserId: string;
  title: string;
  coverUrl?: string | null;
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
  tenantId: string;
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
  tenantId: string;
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

export function createStoryProject(
  teamId: string,
  input: { title: string; visibility?: StoryProjectVisibility },
  idempotencyKey = createIdempotencyKey('create-story-project'),
): Promise<StoryProjectResponse> {
  return sendJson<StoryProjectResponse>(
    `v1/teams/${teamId}/story-projects`,
    'POST',
    {
      title: input.title,
      visibility: input.visibility ?? 'team',
    },
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
