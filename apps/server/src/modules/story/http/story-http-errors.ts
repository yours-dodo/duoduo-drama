import { HttpStatus } from '@nestjs/common';

import { ApplicationError } from '../../../platform/http/application-error.js';
import { IdempotencyConflictError } from '../../tenancy/application/create-team.js';
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
  StoryProjectAccessDeniedError,
  StoryProjectArchivedError,
  StoryProjectNotFoundError,
  StoryProjectRevisionConflictError,
  StoryProjectTitleInvalidError,
} from '../application/story-errors.js';

export function throwStoryHttpError(error: unknown): never {
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
  if (error instanceof StoryProjectArchivedError) {
    throw storyError(
      'STORY_PROJECT_ARCHIVED',
      'Archived story projects cannot be changed',
      HttpStatus.CONFLICT,
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
