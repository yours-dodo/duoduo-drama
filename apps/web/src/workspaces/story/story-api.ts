import { requestJson } from '../../lib/server-api/http-client';

export type StoryProjectVisibility = 'team' | 'private';
export type StoryProjectStatus = 'active' | 'archived';
export type StoryCreationMode = 'standard' | 'immersive';
export type StoryProjectEra = '现代' | '古代';
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
  description: string;
  era: StoryProjectEra;
  tags: string[];
  coverUrl?: string | null;
  creationMode: StoryCreationMode;
  visibility: StoryProjectVisibility;
  status: StoryProjectStatus;
  archivedAt: string | null;
  purgeAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  collaborator: boolean;
  canEdit: boolean;
  canManageCollaborators: boolean;
  canArchive: boolean;
  canRestore: boolean;
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
  'queued' | 'script' | 'images' | 'speech' | 'video';

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

export interface StoryOutlineResponse {
  artifact: StoryArtifact;
  currentVersion: StoryArtifactVersion | null;
}

export type StoryRoleCategory =
  'protagonists' | 'core' | 'supporting' | 'background';
export type StoryRoleGender = '男' | '女' | '未设定';
export type StoryRoleCamp = '主角方' | '对立方' | '中立' | '未明确';
export type StoryRoleAppearanceFrequency =
  '高频' | '中频' | '低频' | '仅被提及';

export interface StoryRoleDialogueExample {
  context: string;
  line: string;
}

export interface StoryRoleSpeechProfile {
  style: string;
  habits: string[];
  dialogueExamples: StoryRoleDialogueExample[];
}

export interface StoryRoleAsset {
  id: string;
  tenantId: string | null;
  projectId: string;
  category: StoryRoleCategory;
  name: string;
  occupation: string;
  personalityCore: string;
  motivationConflict: string;
  mainlineRelation: string;
  gender: StoryRoleGender;
  camp: StoryRoleCamp;
  appearanceFrequency: StoryRoleAppearanceFrequency;
  speechProfile: StoryRoleSpeechProfile;
  coverAssetId: string | null;
  coverAsset: StoryRoleCoverAsset | null;
  viewAssetId: string | null;
  viewAsset: StoryRoleCoverAsset | null;
  revision: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface StoryRoleCoverAsset {
  id: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  downloadUrl: string;
  downloadUrlExpiresAt: string;
}

export interface StoryAsset {
  id: string;
  tenantId: string | null;
  projectId: string;
  uploadedByUserId: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  checksum: string | null;
  status: 'pending_upload' | 'uploaded' | 'failed' | 'deleted';
  uploadExpiresAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryAssetUploadResponse {
  asset: StoryAsset;
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
}

export interface StoryAssetResponse {
  asset: StoryAsset;
}

export interface StoryAssetsResponse {
  items: StoryAsset[];
  nextCursor: string | null;
}

export interface StoryAssetDownloadResponse {
  asset: StoryAsset;
  downloadUrl: string;
  expiresAt: string;
}

export type CreateStoryRoleAssetInput = Pick<
  StoryRoleAsset,
  'category' | 'name'
> &
  Partial<
    Pick<
      StoryRoleAsset,
      | 'occupation'
      | 'personalityCore'
      | 'motivationConflict'
      | 'mainlineRelation'
      | 'gender'
      | 'camp'
      | 'appearanceFrequency'
      | 'speechProfile'
    >
  >;

export type UpdateStoryRoleAssetInput = Partial<
  Pick<
    StoryRoleAsset,
    | 'category'
    | 'name'
    | 'occupation'
    | 'personalityCore'
    | 'motivationConflict'
    | 'mainlineRelation'
    | 'gender'
    | 'camp'
    | 'appearanceFrequency'
    | 'speechProfile'
    | 'coverAssetId'
    | 'viewAssetId'
  >
> & { expectedRevision: number };

export interface StoryRoleAssetsResponse {
  items: StoryRoleAsset[];
}

export interface StoryRoleAssetResponse {
  roleAsset: StoryRoleAsset;
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

export function archiveStoryProject(
  teamId: string,
  projectId: string,
  expectedRevision: number,
): Promise<StoryProjectResponse> {
  return sendJson<StoryProjectResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/archive`,
    'POST',
    { expectedRevision },
  );
}

export function archivePersonalStoryProject(
  projectId: string,
  expectedRevision: number,
): Promise<StoryProjectResponse> {
  return sendJson<StoryProjectResponse>(
    `v1/me/story-projects/${projectId}/archive`,
    'POST',
    { expectedRevision },
  );
}

export function restoreStoryProject(
  teamId: string,
  projectId: string,
  expectedRevision: number,
): Promise<StoryProjectResponse> {
  return sendJson<StoryProjectResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/restore`,
    'POST',
    { expectedRevision },
  );
}

export function restorePersonalStoryProject(
  projectId: string,
  expectedRevision: number,
): Promise<StoryProjectResponse> {
  return sendJson<StoryProjectResponse>(
    `v1/me/story-projects/${projectId}/restore`,
    'POST',
    { expectedRevision },
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

export function listStoryRoleAssets(
  teamId: string,
  projectId: string,
): Promise<StoryRoleAssetsResponse> {
  return requestJson<StoryRoleAssetsResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/role-assets`,
  );
}

export function listPersonalStoryRoleAssets(
  projectId: string,
): Promise<StoryRoleAssetsResponse> {
  return requestJson<StoryRoleAssetsResponse>(
    `v1/me/story-projects/${projectId}/role-assets`,
  );
}

export function createStoryRoleAsset(
  teamId: string,
  projectId: string,
  input: CreateStoryRoleAssetInput,
  idempotencyKey = createIdempotencyKey('create-story-role-asset'),
): Promise<StoryRoleAssetResponse> {
  return sendJson<StoryRoleAssetResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/role-assets`,
    'POST',
    input,
    { 'Idempotency-Key': idempotencyKey },
  );
}

export function createPersonalStoryRoleAsset(
  projectId: string,
  input: CreateStoryRoleAssetInput,
  idempotencyKey = createIdempotencyKey('create-personal-story-role-asset'),
): Promise<StoryRoleAssetResponse> {
  return sendJson<StoryRoleAssetResponse>(
    `v1/me/story-projects/${projectId}/role-assets`,
    'POST',
    input,
    { 'Idempotency-Key': idempotencyKey },
  );
}

export function getStoryRoleAsset(
  teamId: string,
  projectId: string,
  roleId: string,
): Promise<StoryRoleAssetResponse> {
  return requestJson<StoryRoleAssetResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/role-assets/${roleId}`,
  );
}

export function getPersonalStoryRoleAsset(
  projectId: string,
  roleId: string,
): Promise<StoryRoleAssetResponse> {
  return requestJson<StoryRoleAssetResponse>(
    `v1/me/story-projects/${projectId}/role-assets/${roleId}`,
  );
}

export function updateStoryRoleAsset(
  teamId: string,
  projectId: string,
  roleId: string,
  input: UpdateStoryRoleAssetInput,
): Promise<StoryRoleAssetResponse> {
  return sendJson<StoryRoleAssetResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/role-assets/${roleId}`,
    'PATCH',
    input,
  );
}

export function updatePersonalStoryRoleAsset(
  projectId: string,
  roleId: string,
  input: UpdateStoryRoleAssetInput,
): Promise<StoryRoleAssetResponse> {
  return sendJson<StoryRoleAssetResponse>(
    `v1/me/story-projects/${projectId}/role-assets/${roleId}`,
    'PATCH',
    input,
  );
}

export function archiveStoryRoleAsset(
  teamId: string,
  projectId: string,
  roleId: string,
  expectedRevision: number,
): Promise<void> {
  return requestJson<void>(
    `v1/teams/${teamId}/story-projects/${projectId}/role-assets/${roleId}?expectedRevision=${expectedRevision}`,
    { method: 'DELETE' },
  );
}

export function archivePersonalStoryRoleAsset(
  projectId: string,
  roleId: string,
  expectedRevision: number,
): Promise<void> {
  return requestJson<void>(
    `v1/me/story-projects/${projectId}/role-assets/${roleId}?expectedRevision=${expectedRevision}`,
    { method: 'DELETE' },
  );
}

export function createStoryAssetUploadUrl(
  teamId: string,
  projectId: string,
  input: { fileName: string; contentType: string; byteSize: number },
): Promise<StoryAssetUploadResponse> {
  return createAssetUploadUrl(
    `v1/teams/${teamId}/story-projects/${projectId}/assets/upload-url`,
    input,
  );
}

export function createPersonalStoryAssetUploadUrl(
  projectId: string,
  input: { fileName: string; contentType: string; byteSize: number },
): Promise<StoryAssetUploadResponse> {
  return createAssetUploadUrl(
    `v1/me/story-projects/${projectId}/assets/upload-url`,
    input,
  );
}

export function completeStoryAssetUpload(
  teamId: string,
  projectId: string,
  assetId: string,
): Promise<StoryAssetResponse> {
  return requestJson<StoryAssetResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/assets/${assetId}/complete`,
    { method: 'POST' },
  );
}

export function completePersonalStoryAssetUpload(
  projectId: string,
  assetId: string,
): Promise<StoryAssetResponse> {
  return requestJson<StoryAssetResponse>(
    `v1/me/story-projects/${projectId}/assets/${assetId}/complete`,
    { method: 'POST' },
  );
}

export function createStoryAssetDownloadUrl(
  teamId: string,
  projectId: string,
  assetId: string,
): Promise<StoryAssetDownloadResponse> {
  return requestJson<StoryAssetDownloadResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/assets/${assetId}/download-url`,
  );
}

export function listStoryAssets(
  teamId: string,
  projectId: string,
  cursor?: string,
): Promise<StoryAssetsResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return requestJson<StoryAssetsResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/assets${query}`,
  );
}

export function listPersonalStoryAssets(
  projectId: string,
  cursor?: string,
): Promise<StoryAssetsResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return requestJson<StoryAssetsResponse>(
    `v1/me/story-projects/${projectId}/assets${query}`,
  );
}

export function createPersonalStoryAssetDownloadUrl(
  projectId: string,
  assetId: string,
): Promise<StoryAssetDownloadResponse> {
  return requestJson<StoryAssetDownloadResponse>(
    `v1/me/story-projects/${projectId}/assets/${assetId}/download-url`,
  );
}

export function uploadStoryAssetFile(
  uploadUrl: string,
  file: Blob,
  requiredHeaders: Readonly<Record<string, string>> = {},
  onProgress?: (percentage: number) => void,
): Promise<void> {
  if (typeof XMLHttpRequest === 'undefined') {
    return fetch(uploadUrl, {
      method: 'PUT',
      headers: requiredHeaders,
      body: file,
    }).then((response) => {
      if (!response.ok) throw new Error('Asset upload failed');
      onProgress?.(100);
    });
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl);
    Object.entries(requiredHeaders).forEach(([key, value]) =>
      request.setRequestHeader(key, value),
    );
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error('Asset upload failed'));
      }
    };
    request.onerror = () => reject(new Error('Asset upload failed'));
    request.send(file);
  });
}

function createAssetUploadUrl(
  path: string,
  input: { fileName: string; contentType: string; byteSize: number },
): Promise<StoryAssetUploadResponse> {
  return sendJson<StoryAssetUploadResponse>(path, 'POST', input);
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

export function getPersonalStoryProject(
  projectId: string,
): Promise<StoryProjectResponse> {
  return requestJson<StoryProjectResponse>(`v1/me/story-projects/${projectId}`);
}

export interface StoryProjectUpdateInput {
  title?: string;
  description?: string;
  era?: StoryProjectEra;
  tags?: string[];
  expectedRevision: number;
}

export function updateStoryProject(
  teamId: string,
  projectId: string,
  input: StoryProjectUpdateInput,
): Promise<StoryProjectResponse> {
  return sendJson<StoryProjectResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}`,
    'PATCH',
    input,
  );
}

export function updatePersonalStoryProject(
  projectId: string,
  input: StoryProjectUpdateInput,
): Promise<StoryProjectResponse> {
  return sendJson<StoryProjectResponse>(
    `v1/me/story-projects/${projectId}`,
    'PATCH',
    input,
  );
}

export interface StoryProjectTagGenerationInput {
  expectedRevision: number;
  title: string;
  description: string;
}

export function generateStoryProjectTags(
  teamId: string | null,
  projectId: string,
  input: StoryProjectTagGenerationInput,
): Promise<StoryProjectResponse> {
  const path = teamId
    ? `v1/teams/${teamId}/story-projects/${projectId}/tags/generate`
    : `v1/me/story-projects/${projectId}/tags/generate`;
  return sendJson<StoryProjectResponse>(path, 'POST', input);
}

export function listStoryArtifacts(
  teamId: string,
  projectId: string,
): Promise<StoryArtifactsResponse> {
  return requestJson<StoryArtifactsResponse>(
    `v1/teams/${teamId}/story-projects/${projectId}/artifacts`,
  );
}

export function getStoryOutline(scope: {
  teamId?: string | null;
  projectId: string;
}): Promise<StoryOutlineResponse> {
  const path = scope.teamId
    ? `v1/teams/${scope.teamId}/story-projects/${scope.projectId}/outline`
    : `v1/me/story-projects/${scope.projectId}/outline`;
  return requestJson<StoryOutlineResponse>(path);
}

export function saveStoryOutline(
  scope: { teamId?: string | null; projectId: string },
  input: { content: string; expectedVersionNumber?: number },
  idempotencyKey = createIdempotencyKey('save-story-outline'),
): Promise<StoryArtifactMutationResponse> {
  const path = scope.teamId
    ? `v1/teams/${scope.teamId}/story-projects/${scope.projectId}/outline`
    : `v1/me/story-projects/${scope.projectId}/outline`;
  return sendJson<StoryArtifactMutationResponse>(path, 'PUT', input, {
    'Idempotency-Key': idempotencyKey,
  });
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
  method: 'PATCH' | 'POST' | 'PUT',
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
