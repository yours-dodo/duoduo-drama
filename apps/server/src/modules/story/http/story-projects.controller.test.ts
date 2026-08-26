import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp } from '../../../test/create-test-app.js';
import { SESSION_COOKIE_NAME } from '../../identity/http/session-auth.guard.js';
import { IDENTITY_TOKEN_SECURITY } from '../../identity/ports/identity-token-security.js';
import { SESSION_REPOSITORY } from '../../identity/ports/session-repository.js';
import { TEAM_MEMBERSHIP_REPOSITORY } from '../../tenancy/ports/team-membership-repository.js';
import { AddProjectCollaborator } from '../application/add-project-collaborator.js';
import { ArchiveStoryProject } from '../application/archive-story-project.js';
import { RestoreStoryProject } from '../application/restore-story-project.js';
import { CreateStoryProject } from '../application/create-story-project.js';
import { GetStoryProject } from '../application/get-story-project.js';
import { ListProjectAuditRecords } from '../application/list-project-audit-records.js';
import { ListProjectCollaborators } from '../application/list-project-collaborators.js';
import { ListStoryProjects } from '../application/list-story-projects.js';
import { RemoveProjectCollaborator } from '../application/remove-project-collaborator.js';
import { StoryProjectRevisionConflictError } from '../application/story-errors.js';
import { UpdateStoryProject } from '../application/update-story-project.js';

const TEAM_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
const USER_ID = '30000000-0000-4000-8000-000000000001';
const SESSION_TOKEN = 's'.repeat(43);
const NOW = new Date('2026-08-10T05:00:00.000Z');

describe('story project HTTP API', () => {
  let app: INestApplication;
  let useCases: Record<string, { execute: ReturnType<typeof vi.fn> }>;

  beforeEach(async () => {
    useCases = {
      create: executable({
        project: {
          id: PROJECT_ID,
          tenantId: TEAM_ID,
          createdByUserId: USER_ID,
          title: '故事项目',
          visibility: 'team',
          status: 'active',
          revision: 1,
          createdAt: NOW,
          updatedAt: NOW,
          collaborator: false,
          canEdit: true,
          canManageCollaborators: true,
        },
      }),
      list: executable({ items: [], next: null }),
      get: executable({ project: { id: PROJECT_ID } }),
      update: executable({ project: { id: PROJECT_ID, revision: 2 } }),
      archive: executable({ project: { id: PROJECT_ID, status: 'archived' } }),
      restore: executable({ project: { id: PROJECT_ID, status: 'active' } }),
      projectAudit: executable({ items: [], next: null }),
      collaboratorList: executable({ items: [], next: null }),
      collaboratorAdd: executable({ collaborator: { id: 'collaborator-id' } }),
      collaboratorRemove: executable(undefined),
    };

    app = await createTestApp({
      providerOverrides: [
        { token: CreateStoryProject, value: useCases.create },
        { token: ListStoryProjects, value: useCases.list },
        { token: GetStoryProject, value: useCases.get },
        { token: UpdateStoryProject, value: useCases.update },
        { token: ArchiveStoryProject, value: useCases.archive },
        { token: RestoreStoryProject, value: useCases.restore },
        { token: ListProjectAuditRecords, value: useCases.projectAudit },
        { token: ListProjectCollaborators, value: useCases.collaboratorList },
        { token: AddProjectCollaborator, value: useCases.collaboratorAdd },
        {
          token: RemoveProjectCollaborator,
          value: useCases.collaboratorRemove,
        },
        {
          token: TEAM_MEMBERSHIP_REPOSITORY,
          value: {
            findActive: vi.fn(async () => ({
              id: 'membership-id',
              tenantId: TEAM_ID,
              userId: USER_ID,
              role: 'admin',
              joinedAt: NOW,
              removedAt: null,
            })),
          },
        },
        {
          token: SESSION_REPOSITORY,
          value: {
            findActiveByTokenHash: vi.fn(async () => ({
              id: 'session-id',
              userId: USER_ID,
              email: 'creator@example.com',
              expiresAt: new Date('2026-09-10T00:00:00.000Z'),
            })),
          },
        },
        {
          token: IDENTITY_TOKEN_SECURITY,
          value: { hashSessionToken: vi.fn(() => 'session-hash') },
        },
      ],
    });
  });

  afterEach(async () => {
    await app?.close();
  });

  it('exposes project, collaborator, and project-audit resources', async () => {
    const auth = (builder: request.Test) =>
      builder.set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`);
    const write = (builder: request.Test) =>
      auth(builder).set('Origin', 'http://localhost:3000');
    const projectPath = `/v1/teams/${TEAM_ID}/story-projects`;

    await write(request(app.getHttpServer()).post(projectPath))
      .set('Idempotency-Key', 'project-key')
      .send({ title: '故事项目', visibility: 'team' })
      .expect(201);
    await auth(request(app.getHttpServer()).get(projectPath))
      .query({ limit: 25 })
      .expect(200, { items: [], nextCursor: null });
    await auth(
      request(app.getHttpServer()).get(`${projectPath}/${PROJECT_ID}`),
    ).expect(200);
    await auth(
      request(app.getHttpServer()).get(
        `${projectPath}/${PROJECT_ID}/audit-records`,
      ),
    ).expect(200, { items: [], nextCursor: null });
    await write(
      request(app.getHttpServer()).patch(`${projectPath}/${PROJECT_ID}`),
    )
      .send({ title: '新标题', expectedRevision: 1 })
      .expect(200);
    await write(
      request(app.getHttpServer()).post(`${projectPath}/${PROJECT_ID}/archive`),
    )
      .send({ expectedRevision: 2 })
      .expect(200);
    await write(
      request(app.getHttpServer()).post(`${projectPath}/${PROJECT_ID}/restore`),
    )
      .send({ expectedRevision: 3 })
      .expect(200);

    const collaboratorsPath = `${projectPath}/${PROJECT_ID}/collaborators`;
    await auth(request(app.getHttpServer()).get(collaboratorsPath)).expect(
      200,
      {
        items: [],
        nextCursor: null,
      },
    );
    await write(request(app.getHttpServer()).post(collaboratorsPath))
      .send({ userId: USER_ID })
      .expect(201);
    await write(
      request(app.getHttpServer()).delete(`${collaboratorsPath}/${USER_ID}`),
    ).expect(204);

    expect(useCases.create.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TEAM_ID,
        actorUserId: USER_ID,
        idempotencyKey: 'project-key',
      }),
    );
    expect(useCases.update.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        title: '新标题',
        expectedRevision: 1,
      }),
    );
    expect(useCases.collaboratorAdd.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, userId: USER_ID }),
    );
  });

  it('maps revision conflicts and enforces write validation', async () => {
    useCases.update.execute.mockRejectedValueOnce(
      new StoryProjectRevisionConflictError(),
    );
    const conflict = await request(app.getHttpServer())
      .patch(`/v1/teams/${TEAM_ID}/story-projects/${PROJECT_ID}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('Origin', 'http://localhost:3000')
      .set('x-request-id', 'revision-request')
      .send({ title: '新标题', expectedRevision: 1 })
      .expect(409);
    expect(conflict.body.error).toMatchObject({
      code: 'STORY_PROJECT_REVISION_CONFLICT',
      requestId: 'revision-request',
    });

    await request(app.getHttpServer())
      .post(`/v1/teams/${TEAM_ID}/story-projects`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', 'invalid-project')
      .send({ title: '', expectedRevision: 1 })
      .expect(400);
  });
});

function executable(result: unknown) {
  return { execute: vi.fn(async () => result) };
}
