export class StoryProjectNotFoundError extends Error {
  constructor() {
    super('Story project was not found');
    this.name = 'StoryProjectNotFoundError';
  }
}

export {
  StoryProjectArchivedError,
  StoryProjectPurgeUnavailableError,
  StoryProjectRevisionConflictError,
  StoryProjectTitleInvalidError,
  StoryProjectDescriptionInvalidError,
  StoryProjectEraInvalidError,
  StoryProjectTagsInvalidError,
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

export { StoryArtifactVersionStateTransitionError } from '../../../domain/story/story-artifact-version.js';

export class ConversationNotFoundError extends Error {
  constructor() {
    super('Conversation was not found');
    this.name = 'ConversationNotFoundError';
  }
}

export class StoryGenerationRequestNotFoundError extends Error {
  constructor() {
    super('Story generation request was not found');
    this.name = 'StoryGenerationRequestNotFoundError';
  }
}

export class StoryGenerationResultUnavailableError extends Error {
  constructor() {
    super('Story generation result is unavailable');
    this.name = 'StoryGenerationResultUnavailableError';
  }
}

export class StoryArtifactNotFoundError extends Error {
  constructor() {
    super('Story artifact was not found');
    this.name = 'StoryArtifactNotFoundError';
  }
}

export class StoryArtifactVersionNotFoundError extends Error {
  constructor() {
    super('Story artifact version was not found');
    this.name = 'StoryArtifactVersionNotFoundError';
  }
}

export class StoryArtifactVersionConflictError extends Error {
  constructor() {
    super('Story artifact version was changed by another operation');
    this.name = 'StoryArtifactVersionConflictError';
  }
}

export class StoryOutlineContentInvalidError extends Error {
  constructor() {
    super(
      'Story outline content must be a valid narrative-planning.v1 JSON document',
    );
    this.name = 'StoryOutlineContentInvalidError';
  }
}

export class StoryRoleAssetNotFoundError extends Error {
  constructor() {
    super('Story role asset was not found');
    this.name = 'StoryRoleAssetNotFoundError';
  }
}

export class StoryRoleAssetInUseError extends Error {
  constructor() {
    super('Story role asset is referenced by another resource');
    this.name = 'StoryRoleAssetInUseError';
  }
}

export class StoryRoleAssetCoverAssetInvalidError extends Error {
  constructor() {
    super(
      'Story role asset cover must be an uploaded image asset in the same project',
    );
    this.name = 'StoryRoleAssetCoverAssetInvalidError';
  }
}

export class StoryRoleAssetCoverUnavailableError extends Error {
  constructor() {
    super('Story role asset cover is unavailable');
    this.name = 'StoryRoleAssetCoverUnavailableError';
  }
}

export class StoryRoleAssetViewAssetInvalidError extends Error {
  constructor() {
    super(
      'Story role asset view must be an uploaded image asset in the same project',
    );
    this.name = 'StoryRoleAssetViewAssetInvalidError';
  }
}

export class StoryRoleAssetViewUnavailableError extends Error {
  constructor() {
    super('Story role asset view is unavailable');
    this.name = 'StoryRoleAssetViewUnavailableError';
  }
}

export class StoryProjectAccessDeniedError extends Error {
  constructor() {
    super('The story project cannot be accessed');
    this.name = 'StoryProjectAccessDeniedError';
  }
}

export class StoryProjectSpaceMoveRequiredError extends Error {
  constructor() {
    super('Changing project visibility requires an explicit space move');
    this.name = 'StoryProjectSpaceMoveRequiredError';
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

export class ProjectCollaboratorPermissionOverrideNotAllowedError extends Error {
  constructor() {
    super('The project collaborator permission override is not allowed');
    this.name = 'ProjectCollaboratorPermissionOverrideNotAllowedError';
  }
}

export class ProjectCollaboratorRoleInvalidError extends Error {
  constructor() {
    super('The project collaborator role is invalid');
    this.name = 'ProjectCollaboratorRoleInvalidError';
  }
}
