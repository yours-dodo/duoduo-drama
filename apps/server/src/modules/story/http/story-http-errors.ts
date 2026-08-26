import { HttpStatus } from '@nestjs/common';

import { ApplicationError } from '../../../platform/http/application-error.js';
import { AgentGatewayError } from '../../../integrations/agent/agent-gateway.js';
import { StoryImportFileInvalidError } from '../../../domain/story/story-import-job.js';
import { IdempotencyConflictError } from '../../tenancy/application/create-team.js';
import {
  StoryRoleAssetArchivedError,
  StoryRoleAssetInvalidError,
  StoryRoleAssetRevisionConflictError,
} from '../../../domain/story/story-role-asset.js';
import {
  ConversationArchivedError,
  ConversationNotFoundError,
  ConversationRevisionConflictError,
  ConversationTitleInvalidError,
  MessageAuthorInvalidError,
  MessageBodyInvalidError,
  ProjectCollaboratorAlreadyExistsError,
  ProjectCollaboratorManagementRequiredError,
  ProjectCollaboratorNotFoundError,
  ProjectCollaboratorTargetIsCreatorError,
  ProjectCollaboratorTargetNotFoundError,
  ProjectCollaboratorsNotAllowedError,
  ProjectCollaboratorPermissionOverrideNotAllowedError,
  ProjectCollaboratorRoleInvalidError,
  StoryProjectAccessDeniedError,
  StoryProjectArchivedError,
  StoryProjectPurgeUnavailableError,
  StoryProjectNotFoundError,
  StoryProjectRevisionConflictError,
  StoryProjectSpaceMoveRequiredError,
  StoryProjectTitleInvalidError,
  StoryProjectDescriptionInvalidError,
  StoryProjectEraInvalidError,
  StoryProjectTagsInvalidError,
  StoryGenerationRequestNotFoundError,
  StoryGenerationResultUnavailableError,
  StoryArtifactNotFoundError,
  StoryArtifactVersionNotFoundError,
  StoryArtifactVersionConflictError,
  StoryArtifactVersionStateTransitionError,
  StoryOutlineContentInvalidError,
  StoryRoleAssetInUseError,
  StoryRoleAssetNotFoundError,
  StoryRoleAssetCoverAssetInvalidError,
  StoryRoleAssetCoverUnavailableError,
  StoryRoleAssetViewAssetInvalidError,
  StoryRoleAssetViewUnavailableError,
} from '../application/story-errors.js';

export function throwStoryHttpError(error: unknown): never {
  if (error instanceof AgentGatewayError) {
    const status =
      error.failureCode === 'timeout'
        ? HttpStatus.GATEWAY_TIMEOUT
        : error.failureCode === 'protocol_error'
          ? HttpStatus.BAD_GATEWAY
          : HttpStatus.SERVICE_UNAVAILABLE;
    throw storyError(
      'STORY_TAG_GENERATION_FAILED',
      'Story AI tag generation is temporarily unavailable',
      status,
    );
  }
  if (error instanceof StoryRoleAssetNotFoundError) {
    throw storyError(
      'STORY_ROLE_ASSET_NOT_FOUND',
      'Story role asset not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof StoryRoleAssetInvalidError) {
    throw storyError(
      'STORY_ROLE_ASSET_INVALID',
      'Story role asset is invalid',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof StoryRoleAssetRevisionConflictError) {
    throw storyError(
      'STORY_ROLE_ASSET_REVISION_CONFLICT',
      'Story role asset was changed by another operation',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof StoryRoleAssetInUseError) {
    throw storyError(
      'STORY_ROLE_ASSET_IN_USE',
      'Story role asset is referenced by another resource',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof StoryRoleAssetCoverAssetInvalidError) {
    throw storyError(
      'STORY_ROLE_ASSET_COVER_ASSET_INVALID',
      'Story role cover must be an uploaded image asset in the same project',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof StoryRoleAssetCoverUnavailableError) {
    throw storyError(
      'STORY_ROLE_ASSET_COVER_UNAVAILABLE',
      'Story role cover is temporarily unavailable',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof StoryRoleAssetViewAssetInvalidError) {
    throw storyError(
      'STORY_ROLE_ASSET_VIEW_ASSET_INVALID',
      'Story role view must be an uploaded image asset in the same project',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof StoryRoleAssetViewUnavailableError) {
    throw storyError(
      'STORY_ROLE_ASSET_VIEW_UNAVAILABLE',
      'Story role view is temporarily unavailable',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof StoryRoleAssetArchivedError) {
    throw storyError(
      'STORY_ROLE_ASSET_NOT_FOUND',
      'Story role asset not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof StoryImportFileInvalidError) {
    throw storyError(
      'STORY_IMPORT_FILE_INVALID',
      'Story import file is invalid',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof ConversationNotFoundError) {
    throw storyError(
      'CONVERSATION_NOT_FOUND',
      'Conversation not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof ConversationRevisionConflictError) {
    throw storyError(
      'CONVERSATION_REVISION_CONFLICT',
      'Conversation was changed by another operation',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof ConversationArchivedError) {
    throw storyError(
      'CONVERSATION_ARCHIVED',
      'Archived conversations cannot be changed',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof ConversationTitleInvalidError) {
    throw storyError(
      'CONVERSATION_TITLE_INVALID',
      'Conversation title is invalid',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof StoryGenerationRequestNotFoundError) {
    throw storyError(
      'STORY_GENERATION_REQUEST_NOT_FOUND',
      'Story generation request not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof StoryGenerationResultUnavailableError) {
    throw storyError(
      'STORY_GENERATION_RESULT_UNAVAILABLE',
      'Story generation result is unavailable',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof StoryArtifactNotFoundError) {
    throw storyError(
      'STORY_ARTIFACT_NOT_FOUND',
      'Story artifact not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof StoryArtifactVersionNotFoundError) {
    throw storyError(
      'STORY_ARTIFACT_VERSION_NOT_FOUND',
      'Story artifact version not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof StoryArtifactVersionConflictError) {
    throw storyError(
      'STORY_ARTIFACT_VERSION_CONFLICT',
      'Story artifact version was changed by another operation',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof StoryOutlineContentInvalidError) {
    throw storyError(
      'STORY_OUTLINE_CONTENT_INVALID',
      'Story outline content is invalid',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof StoryArtifactVersionStateTransitionError) {
    throw storyError(
      'STORY_ARTIFACT_VERSION_STATE_INVALID',
      'Story artifact version cannot perform this operation',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof MessageBodyInvalidError) {
    throw storyError(
      'MESSAGE_BODY_INVALID',
      'Message body is invalid',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof MessageAuthorInvalidError) {
    throw storyError(
      'MESSAGE_AUTHOR_INVALID',
      'Message author is invalid',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof StoryProjectNotFoundError) {
    throw storyError(
      'STORY_PROJECT_NOT_FOUND',
      'Story project not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof StoryProjectAccessDeniedError) {
    throw storyError(
      'STORY_PROJECT_ACCESS_DENIED',
      'Story project access denied',
      HttpStatus.FORBIDDEN,
    );
  }
  if (error instanceof StoryProjectRevisionConflictError) {
    throw storyError(
      'STORY_PROJECT_REVISION_CONFLICT',
      'Story project was changed by another operation',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof StoryProjectSpaceMoveRequiredError) {
    throw storyError(
      'STORY_PROJECT_SPACE_MOVE_REQUIRED',
      'Changing project visibility requires an explicit space move',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof StoryProjectArchivedError) {
    throw storyError(
      'STORY_PROJECT_ARCHIVED',
      'Archived story projects cannot be changed',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof StoryProjectPurgeUnavailableError) {
    throw storyError(
      'STORY_PROJECT_PURGE_UNAVAILABLE',
      'This story project can no longer be restored',
      HttpStatus.GONE,
    );
  }
  if (error instanceof StoryProjectTitleInvalidError) {
    throw storyError(
      'STORY_PROJECT_TITLE_INVALID',
      'Story project title is invalid',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (
    error instanceof StoryProjectDescriptionInvalidError ||
    error instanceof StoryProjectEraInvalidError ||
    error instanceof StoryProjectTagsInvalidError
  ) {
    throw storyError(
      'STORY_PROJECT_METADATA_INVALID',
      'Story project metadata is invalid',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (
    error instanceof ProjectCollaboratorNotFoundError ||
    error instanceof ProjectCollaboratorTargetNotFoundError
  ) {
    throw storyError(
      'PROJECT_COLLABORATOR_NOT_FOUND',
      'Project collaborator not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof ProjectCollaboratorManagementRequiredError) {
    throw storyError(
      'PROJECT_COLLABORATOR_MANAGEMENT_REQUIRED',
      'Project collaborator management access is required',
      HttpStatus.FORBIDDEN,
    );
  }
  if (error instanceof ProjectCollaboratorAlreadyExistsError) {
    throw storyError(
      'PROJECT_COLLABORATOR_ALREADY_EXISTS',
      'The user is already a project collaborator',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof ProjectCollaboratorTargetIsCreatorError) {
    throw storyError(
      'PROJECT_COLLABORATOR_TARGET_IS_CREATOR',
      'The project creator does not need a collaborator grant',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof ProjectCollaboratorRoleInvalidError) {
    throw storyError(
      'PROJECT_COLLABORATOR_ROLE_INVALID',
      'Project collaborator role is invalid',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof ProjectCollaboratorPermissionOverrideNotAllowedError) {
    throw storyError(
      'PROJECT_COLLABORATOR_PERMISSION_OVERRIDE_NOT_ALLOWED',
      'Project collaborator permission override is not allowed',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof ProjectCollaboratorsNotAllowedError) {
    throw storyError(
      'PROJECT_COLLABORATORS_NOT_ALLOWED',
      'Private or archived projects cannot have collaborators',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof IdempotencyConflictError) {
    throw storyError(
      'IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key was used with different input',
      HttpStatus.CONFLICT,
    );
  }
  throw error;
}

function storyError(
  code: string,
  message: string,
  statusCode: number,
): ApplicationError {
  return new ApplicationError({ code, message, statusCode });
}
