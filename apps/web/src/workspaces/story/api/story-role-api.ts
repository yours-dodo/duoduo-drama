import {
  archivePersonalStoryRoleAsset,
  archiveStoryRoleAsset,
  createPersonalStoryRoleAsset,
  createStoryRoleAsset,
  getPersonalStoryRoleAsset,
  getStoryRoleAsset,
  listPersonalStoryRoleAssets,
  listStoryRoleAssets,
  updatePersonalStoryRoleAsset,
  updateStoryRoleAsset,
  type CreateStoryRoleAssetInput,
  type UpdateStoryRoleAssetInput,
} from './story-api';

export type StoryRoleProjectScope = {
  projectId: string;
  teamId: string | null;
};

export {
  completePersonalStoryAssetUpload,
  completeStoryAssetUpload,
  createPersonalStoryAssetDownloadUrl,
  createPersonalStoryAssetUploadUrl,
  createStoryAssetDownloadUrl,
  createStoryAssetUploadUrl,
  listPersonalStoryAssets,
  listStoryAssets,
  uploadStoryAssetFile,
} from './story-api';

export function listProjectStoryRoleAssets(scope: StoryRoleProjectScope) {
  return scope.teamId
    ? listStoryRoleAssets(scope.teamId, scope.projectId)
    : listPersonalStoryRoleAssets(scope.projectId);
}

export function createProjectStoryRoleAsset(
  scope: StoryRoleProjectScope,
  input: CreateStoryRoleAssetInput,
) {
  return scope.teamId
    ? createStoryRoleAsset(scope.teamId, scope.projectId, input)
    : createPersonalStoryRoleAsset(scope.projectId, input);
}

export function getProjectStoryRoleAsset(
  scope: StoryRoleProjectScope,
  roleId: string,
) {
  return scope.teamId
    ? getStoryRoleAsset(scope.teamId, scope.projectId, roleId)
    : getPersonalStoryRoleAsset(scope.projectId, roleId);
}

export function updateProjectStoryRoleAsset(
  scope: StoryRoleProjectScope,
  roleId: string,
  input: UpdateStoryRoleAssetInput,
) {
  return scope.teamId
    ? updateStoryRoleAsset(scope.teamId, scope.projectId, roleId, input)
    : updatePersonalStoryRoleAsset(scope.projectId, roleId, input);
}

export function archiveProjectStoryRoleAsset(
  scope: StoryRoleProjectScope,
  roleId: string,
  expectedRevision: number,
) {
  return scope.teamId
    ? archiveStoryRoleAsset(
        scope.teamId,
        scope.projectId,
        roleId,
        expectedRevision,
      )
    : archivePersonalStoryRoleAsset(scope.projectId, roleId, expectedRevision);
}
