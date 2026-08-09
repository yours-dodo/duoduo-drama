import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
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
import { readRequestId } from '../../../platform/http/request-id.middleware.js';
import { SessionAuthGuard } from '../../identity/http/session-auth.guard.js';
import { KeysetPageDto } from '../../tenancy/http/keyset-page.dto.js';
import {
  readTenantContext,
  TenantContextGuard,
} from '../../tenancy/http/tenant-context.guard.js';
import { AddProjectCollaborator } from '../application/add-project-collaborator.js';
import { ListProjectCollaborators } from '../application/list-project-collaborators.js';
import { RemoveProjectCollaborator } from '../application/remove-project-collaborator.js';
import { AddProjectCollaboratorDto } from './story-project.dto.js';
import { throwStoryHttpError } from './story-http-errors.js';

@Controller({
  path: 'teams/:teamId/story-projects/:projectId/collaborators',
  version: '1',
})
@UseGuards(SessionAuthGuard, TenantContextGuard)
export class ProjectCollaboratorsController {
  constructor(
    @Inject(AddProjectCollaborator)
    private readonly addCollaborator: AddProjectCollaborator,
    @Inject(RemoveProjectCollaborator)
    private readonly removeCollaborator: RemoveProjectCollaborator,
    @Inject(ListProjectCollaborators)
    private readonly listCollaborators: ListProjectCollaborators,
  ) {}

  @Get()
  async list(
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
        await this.listCollaborators.execute({
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

  @Post()
  async add(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body(
      new ValidationPipe({
        expectedType: AddProjectCollaboratorDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: AddProjectCollaboratorDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.addCollaborator.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        userId: body.userId,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Req() request: Request,
  ): Promise<void> {
    const tenant = readTenantContext(request);
    try {
      await this.removeCollaborator.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        userId,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }
}
