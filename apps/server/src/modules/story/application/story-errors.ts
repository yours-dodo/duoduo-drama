export class StoryProjectNotFoundError extends Error {
  constructor() {
    super('Story project was not found');
    this.name = 'StoryProjectNotFoundError';
  }
}

export {
  StoryProjectArchivedError,
  StoryProjectRevisionConflictError,
  StoryProjectTitleInvalidError,
} from '../../../domain/story/story-project.js';

export {
  ConversationArchivedError,
  ConversationRevisionConflictError,
  ConversationTitleInvalidError,
} from '../../../domain/story/conversation.js';

export {
  MessageAuthorInvalidError,
  MessageBodyInvalidError,
} from '../../../domain/story/message.js';

export class ConversationNotFoundError extends Error {
  constructor() {
    super('Conversation was not found');
    this.name = 'ConversationNotFoundError';
  }
}

export class StoryProjectAccessDeniedError extends Error {
  constructor() {
    super('The story project cannot be accessed');
    this.name = 'StoryProjectAccessDeniedError';
  }
}

export class ProjectCollaboratorNotFoundError extends Error {
  constructor() {
    super('Project collaborator was not found');
    this.name = 'ProjectCollaboratorNotFoundError';
  }
}

export class ProjectCollaboratorTargetNotFoundError extends Error {
  constructor() {
    super('Project collaborator target was not found');
    this.name = 'ProjectCollaboratorTargetNotFoundError';
  }
}

export class ProjectCollaboratorAlreadyExistsError extends Error {
  constructor() {
    super('The user is already a project collaborator');
    this.name = 'ProjectCollaboratorAlreadyExistsError';
  }
}

export class ProjectCollaboratorsNotAllowedError extends Error {
  constructor() {
    super('Private or archived projects cannot have collaborators');
    this.name = 'ProjectCollaboratorsNotAllowedError';
  }
}

export class ProjectCollaboratorManagementRequiredError extends Error {
  constructor() {
    super('Project collaborator management access is required');
    this.name = 'ProjectCollaboratorManagementRequiredError';
  }
}

export class ProjectCollaboratorTargetIsCreatorError extends Error {
  constructor() {
    super('The project creator does not need a collaborator grant');
    this.name = 'ProjectCollaboratorTargetIsCreatorError';
  }
}
