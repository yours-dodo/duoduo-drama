import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';

import { readIdempotencyKey } from '../../../platform/http/idempotency-key.js';
import { readRequestId } from '../../../platform/http/request-id.middleware.js';
import { SessionAuthGuard } from '../../identity/http/session-auth.guard.js';
import {
  readTenantContext,
  TenantContextGuard,
} from '../../tenancy/http/tenant-context.guard.js';
import { ConfirmStoryDraft } from '../application/confirm-story-draft.js';
import { DiscardStoryDraft } from '../application/discard-story-draft.js';
import { EditStoryDraft } from '../application/edit-story-draft.js';
import { GetStoryArtifact } from '../application/get-story-artifact.js';
import { ListStoryArtifacts } from '../application/list-story-artifacts.js';
import { ListStoryVersions } from '../application/list-story-versions.js';
import { RollbackStoryArtifact } from '../application/rollback-story-artifact.js';
import {
  ConfirmStoryDraftDto,
  DiscardStoryDraftDto,
  EditStoryDraftDto,
  RollbackStoryArtifactDto,
} from './story-artifact.dto.js';
import { throwStoryHttpError } from './story-http-errors.js';

@Controller({
  path: 'teams/:teamId/story-projects/:projectId/artifacts',
  version: '1',
})
@UseGuards(SessionAuthGuard, TenantContextGuard)
export class StoryArtifactsController {
  constructor(
    @Inject(ListStoryArtifacts)
    private readonly listArtifacts: ListStoryArtifacts,
    @Inject(GetStoryArtifact)
    private readonly getArtifact: GetStoryArtifact,
    @Inject(ListStoryVersions)
    private readonly listVersions: ListStoryVersions,
    @Inject(EditStoryDraft)
    private readonly editDraft: EditStoryDraft,
    @Inject(DiscardStoryDraft)
    private readonly discardDraft: DiscardStoryDraft,
    @Inject(ConfirmStoryDraft)
    private readonly confirmDraft: ConfirmStoryDraft,
    @Inject(RollbackStoryArtifact)
    private readonly rollbackArtifact: RollbackStoryArtifact,
  ) {}

  @Get()
  async list(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.listArtifacts.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Get(':artifactId/versions')
  async versions(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('artifactId', new ParseUUIDPipe({ version: '4' }))
    artifactId: string,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.listVersions.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        artifactId,
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Get(':artifactId')
  async get(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('artifactId', new ParseUUIDPipe({ version: '4' }))
    artifactId: string,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.getArtifact.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        artifactId,
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Patch(':artifactId/drafts/:versionId')
  async edit(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('artifactId', new ParseUUIDPipe({ version: '4' }))
    artifactId: string,
    @Param('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
    @Body(
      new ValidationPipe({
        expectedType: EditStoryDraftDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: EditStoryDraftDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.editDraft.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        artifactId,
        versionId,
        expectedVersionNumber: body.expectedVersionNumber,
        content: body.content,
        contentFormat: body.contentFormat,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Post(':artifactId/drafts/:versionId/discard')
  @HttpCode(HttpStatus.OK)
  async discard(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('artifactId', new ParseUUIDPipe({ version: '4' }))
    artifactId: string,
    @Param('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
    @Body(
      new ValidationPipe({
        expectedType: DiscardStoryDraftDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: DiscardStoryDraftDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.discardDraft.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        artifactId,
        versionId,
        expectedVersionNumber: body.expectedVersionNumber,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Post(':artifactId/drafts/:versionId/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('artifactId', new ParseUUIDPipe({ version: '4' }))
    artifactId: string,
    @Param('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
    @Body(
      new ValidationPipe({
        expectedType: ConfirmStoryDraftDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: ConfirmStoryDraftDto,
    @Headers('idempotency-key') suppliedIdempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.confirmDraft.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        artifactId,
        versionId,
        expectedVersionNumber: body.expectedVersionNumber,
        idempotencyKey: readIdempotencyKey(suppliedIdempotencyKey),
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Post(':artifactId/rollback')
  @HttpCode(HttpStatus.OK)
  async rollback(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('artifactId', new ParseUUIDPipe({ version: '4' }))
    artifactId: string,
    @Body(
      new ValidationPipe({
        expectedType: RollbackStoryArtifactDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: RollbackStoryArtifactDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.rollbackArtifact.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        artifactId,
        targetVersionNumber: body.targetVersionNumber,
        expectedCurrentVersionNumber: body.expectedCurrentVersionNumber ?? null,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }
}
