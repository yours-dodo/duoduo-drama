import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoryRoleAssetRevisionConflictError } from '../../../domain/story/story-role-asset.js';
import { createTestApp } from '../../../test/create-test-app.js';
import { SESSION_COOKIE_NAME } from '../../identity/http/session-auth.guard.js';
import { IDENTITY_TOKEN_SECURITY } from '../../identity/ports/identity-token-security.js';
import { SESSION_REPOSITORY } from '../../identity/ports/session-repository.js';
import { TEAM_MEMBERSHIP_REPOSITORY } from '../../tenancy/ports/team-membership-repository.js';
import { ArchiveStoryRoleAsset } from '../application/archive-story-role-asset.js';
import { CreateStoryRoleAsset } from '../application/create-story-role-asset.js';
import { GetStoryRoleAsset } from '../application/get-story-role-asset.js';
import { ListStoryRoleAssets } from '../application/list-story-role-assets.js';
import { UpdateStoryRoleAsset } from '../application/update-story-role-asset.js';

const TEAM_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
const ROLE_ID = '30000000-0000-4000-8000-000000000001';
const USER_ID = '40000000-0000-4000-8000-000000000001';
const SESSION_TOKEN = 's'.repeat(43);
const NOW = new Date('2026-08-20T10:00:00.000Z');

describe('story role asset HTTP API', () => {
  let app: INestApplication;
  let useCases: Record<string, { execute: ReturnType<typeof vi.fn> }>;

  beforeEach(async () => {
    const roleAsset = {
      id: ROLE_ID,
      tenantId: TEAM_ID,
      projectId: PROJECT_ID,
      category: 'protagonists',
      name: '林遥',
      occupation: '档案修复师',
      personalityCore: '',
      motivationConflict: '',
      mainlineRelation: '',
      gender: '女',
      camp: '主角方',
      appearanceFrequency: '高频',
      speechProfile: {
        style: '',
        habits: [],
        dialogueExamples: [],
      },
      revision: 1,
      createdByUserId: USER_ID,
      updatedByUserId: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    };
    useCases = {
      create: executable({ roleAsset }),
      list: executable({ items: [roleAsset] }),
      get: executable({ roleAsset }),
      update: executable({ roleAsset: { ...roleAsset, revision: 2 } }),
      archive: executable(undefined),
    };

    app = await createTestApp({
      providerOverrides: [
        { token: CreateStoryRoleAsset, value: useCases.create },
        { token: ListStoryRoleAssets, value: useCases.list },
        { token: GetStoryRoleAsset, value: useCases.get },
        { token: UpdateStoryRoleAsset, value: useCases.update },
        { token: ArchiveStoryRoleAsset, value: useCases.archive },
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
              expiresAt: new Date('2026-09-20T00:00:00.000Z'),
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

  it('exposes team role asset CRUD without accepting a client id', async () => {
    const auth = (builder: request.Test) =>
      builder.set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`);
    const write = (builder: request.Test) =>
      auth(builder).set('Origin', 'http://localhost:3000');
    const path = `/v1/teams/${TEAM_ID}/story-projects/${PROJECT_ID}/role-assets`;

    await write(request(app.getHttpServer()).post(path))
      .set('Idempotency-Key', 'create-role-key')
      .send({ category: 'protagonists', name: '林遥' })
      .expect(201);
    await auth(request(app.getHttpServer()).get(path)).expect(200);
    await auth(request(app.getHttpServer()).get(`${path}/${ROLE_ID}`)).expect(
      200,
    );
    await write(request(app.getHttpServer()).patch(`${path}/${ROLE_ID}`))
      .send({ expectedRevision: 1, name: '林遥（新版）' })
      .expect(200);
    await write(request(app.getHttpServer()).delete(`${path}/${ROLE_ID}`))
      .query({ expectedRevision: 2 })
      .expect(204);

    expect(useCases.create.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TEAM_ID,
        actorUserId: USER_ID,
        projectId: PROJECT_ID,
        name: '林遥',
      }),
    );
    expect(useCases.archive.execute).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 2 }),
    );

    await write(request(app.getHttpServer()).post(path))
      .set('Idempotency-Key', 'client-id-is-forbidden')
      .send({ id: ROLE_ID, category: 'protagonists', name: '非法角色' })
      .expect(400);
    expect(useCases.create.execute).toHaveBeenCalledTimes(1);
  });

  it('maps role revision conflicts and rejects non-uuid role paths', async () => {
    useCases.update.execute.mockRejectedValueOnce(
      new StoryRoleAssetRevisionConflictError(),
    );
    const path = `/v1/teams/${TEAM_ID}/story-projects/${PROJECT_ID}/role-assets/${ROLE_ID}`;
    const conflict = await request(app.getHttpServer())
      .patch(path)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('Origin', 'http://localhost:3000')
      .set('x-request-id', 'role-revision-request')
      .send({ expectedRevision: 1, name: '冲突角色' })
      .expect(409);
    expect(conflict.body.error).toMatchObject({
      code: 'STORY_ROLE_ASSET_REVISION_CONFLICT',
      requestId: 'role-revision-request',
    });

    await request(app.getHttpServer())
      .get(
        `/v1/teams/${TEAM_ID}/story-projects/${PROJECT_ID}/role-assets/not-a-uuid`,
      )
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .expect(400);
  });
});

function executable(result: unknown) {
  return { execute: vi.fn(async () => result) };
}
