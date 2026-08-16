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
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';

import {
  keysetPageResponse,
  readKeysetPage,
} from '../../../platform/http/keyset-page.js';
import { readIdempotencyKey } from '../../../platform/http/idempotency-key.js';
import { readRequestId } from '../../../platform/http/request-id.middleware.js';
import { SessionAuthGuard } from '../../identity/http/session-auth.guard.js';
import { KeysetPageDto } from '../../tenancy/http/keyset-page.dto.js';
import {
  readTenantContext,
  TenantContextGuard,
} from '../../tenancy/http/tenant-context.guard.js';
import { ArchiveStoryProject } from '../application/archive-story-project.js';
import { CreateStoryProject } from '../application/create-story-project.js';
import { GetStoryProject } from '../application/get-story-project.js';
import { ListProjectAuditRecords } from '../application/list-project-audit-records.js';
import { ListStoryProjects } from '../application/list-story-projects.js';
import { UpdateStoryProject } from '../application/update-story-project.js';
import {
  ArchiveStoryProjectDto,
  CreateStoryProjectDto,
  UpdateStoryProjectDto,
} from './story-project.dto.js';
import { throwStoryHttpError } from './story-http-errors.js';

@Controller({ path: 'teams/:teamId/story-projects', version: '1' })
@UseGuards(SessionAuthGuard, TenantContextGuard)
export class StoryProjectsController {
  constructor(
    @Inject(CreateStoryProject)
    private readonly createProject: CreateStoryProject,
    @Inject(ListStoryProjects)
    private readonly listProjects: ListStoryProjects,
    @Inject(GetStoryProject)
    private readonly getProject: GetStoryProject,
    @Inject(UpdateStoryProject)
    private readonly updateProject: UpdateStoryProject,
    @Inject(ArchiveStoryProject)
    private readonly archiveProject: ArchiveStoryProject,
    @Inject(ListProjectAuditRecords)
    private readonly listProjectAudit: ListProjectAuditRecords,
  ) {}

  @Post()
  async create(
    @Body(
      new ValidationPipe({
        expectedType: CreateStoryProjectDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: CreateStoryProjectDto,
    @Headers('idempotency-key') suppliedIdempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.createProject.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        title: body.title,
        creationMode: body.creationMode,
        visibility: body.visibility,
        idempotencyKey: readIdempotencyKey(suppliedIdempotencyKey),
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Get()
  async list(
    @Query(
      new ValidationPipe({
        expectedType: KeysetPageDto,
        transform: true,
        whitelist: true,
      }),
    )
    query: KeysetPageDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return keysetPageResponse(
        await this.listProjects.execute({
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          page: readKeysetPage(query),
          requestId: readRequestId(request),
        }),
      );
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Get(':projectId/audit-records')
  async auditRecords(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Query(
      new ValidationPipe({
        expectedType: KeysetPageDto,
        transform: true,
        whitelist: true,
      }),
    )
    query: KeysetPageDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return keysetPageResponse(
        await this.listProjectAudit.execute({
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          projectId,
          page: readKeysetPage(query),
        }),
      );
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Get(':projectId')
  async get(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.getProject.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Patch(':projectId')
  async update(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body(
      new ValidationPipe({
        expectedType: UpdateStoryProjectDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: UpdateStoryProjectDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.updateProject.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        title: body.title,
        visibility: body.visibility,
        expectedRevision: body.expectedRevision,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Post(':projectId/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body(
      new ValidationPipe({
        expectedType: ArchiveStoryProjectDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: ArchiveStoryProjectDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.archiveProject.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        expectedRevision: body.expectedRevision,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }
}
