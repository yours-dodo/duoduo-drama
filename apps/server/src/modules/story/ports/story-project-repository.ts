import type {
  StoryProjectSnapshot,
  StoryProjectStatus,
  StoryProjectVisibility,
} from '../../../domain/story/story-project.js';
import type { ProjectCollaboratorRole } from '../../../domain/story/project-collaborator.js';
import type {
  KeysetPage,
  KeysetPageRequest,
} from '../../../platform/pagination/keyset-page.js';

export const STORY_PROJECT_REPOSITORY = Symbol('STORY_PROJECT_REPOSITORY');

export interface StoryProjectListItem extends StoryProjectSnapshot {
  collaborator: boolean;
  collaboratorRole: ProjectCollaboratorRole | null;
}

export interface StoryProjectListRequest {
  tenantId: string | null;
  spaceId?: string;
  actorUserId: string;
  actorRole: 'admin' | 'member' | null;
  page: KeysetPageRequest;
}

export interface StoryProjectRepository {
  create(project: StoryProjectSnapshot): Promise<StoryProjectSnapshot>;
  update(project: StoryProjectSnapshot): Promise<StoryProjectSnapshot>;
  findById(request: {
    tenantId?: string | null;
    projectId: string;
  }): Promise<StoryProjectSnapshot | null>;
  findByIdLocked(request: {
    tenantId?: string | null;
    projectId: string;
  }): Promise<StoryProjectSnapshot | null>;
  listVisible(
    request: StoryProjectListRequest,
  ): Promise<KeysetPage<StoryProjectListItem>>;
}

export type StoryProjectMutation = {
  title?: string;
  visibility?: StoryProjectVisibility;
  status?: StoryProjectStatus;
};
