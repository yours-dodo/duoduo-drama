import {
  Body,
  Controller,
  Delete,
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

import { readIdempotencyKey } from '../../../platform/http/idempotency-key.js';
import { readRequestId } from '../../../platform/http/request-id.middleware.js';
import { SessionAuthGuard } from '../../identity/http/session-auth.guard.js';
import {
  readTenantContext,
  TenantContextGuard,
} from '../../tenancy/http/tenant-context.guard.js';
import { ArchiveStoryRoleAsset } from '../application/archive-story-role-asset.js';
import { CreateStoryRoleAsset } from '../application/create-story-role-asset.js';
import { GetStoryRoleAsset } from '../application/get-story-role-asset.js';
import { ListStoryRoleAssets } from '../application/list-story-role-assets.js';
import { UpdateStoryRoleAsset } from '../application/update-story-role-asset.js';
import { throwStoryHttpError } from './story-http-errors.js';
import {
  ArchiveStoryRoleAssetQueryDto,
  CreateStoryRoleAssetDto,
  UpdateStoryRoleAssetDto,
} from './story-role-asset.dto.js';

const bodyValidation = (expectedType: new () => object) =>
  new ValidationPipe({
    expectedType,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

@Controller({
  path: 'teams/:teamId/story-projects/:projectId/role-assets',
  version: '1',
})
@UseGuards(SessionAuthGuard, TenantContextGuard)
export class StoryRoleAssetsController {
  constructor(
    @Inject(ListStoryRoleAssets)
    private readonly listRoles: ListStoryRoleAssets,
    @Inject(CreateStoryRoleAsset)
    private readonly createRole: CreateStoryRoleAsset,
    @Inject(GetStoryRoleAsset) private readonly getRole: GetStoryRoleAsset,
    @Inject(UpdateStoryRoleAsset)
    private readonly updateRole: UpdateStoryRoleAsset,
    @Inject(ArchiveStoryRoleAsset)
    private readonly archiveRole: ArchiveStoryRoleAsset,
  ) {}

  @Get()
  async list(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.listRoles.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Post()
  async create(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body(bodyValidation(CreateStoryRoleAssetDto))
    body: CreateStoryRoleAssetDto,
    @Headers('idempotency-key') suppliedIdempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.createRole.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        ...body,
        idempotencyKey: readIdempotencyKey(suppliedIdempotencyKey),
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Get(':roleId')
  async get(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.getRole.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        roleId,
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Patch(':roleId')
  async update(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
    @Body(bodyValidation(UpdateStoryRoleAssetDto))
    body: UpdateStoryRoleAssetDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.updateRole.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        roleId,
        ...body,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
    @Query(bodyValidation(ArchiveStoryRoleAssetQueryDto))
    query: ArchiveStoryRoleAssetQueryDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      await this.archiveRole.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        roleId,
        expectedRevision: query.expectedRevision,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }
}
