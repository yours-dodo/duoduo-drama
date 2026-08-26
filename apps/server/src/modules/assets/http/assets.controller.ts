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
import { SessionAuthGuard } from '../../identity/http/session-auth.guard.js';
import {
  readTenantContext,
  TenantContextGuard,
} from '../../tenancy/http/tenant-context.guard.js';
import { CompleteAssetUpload } from '../application/complete-asset-upload.js';
import { CreateAssetDownloadUrl } from '../application/create-asset-download-url.js';
import { CreateAssetUploadUrl } from '../application/create-asset-upload-url.js';
import { DeleteAsset } from '../application/delete-asset.js';
import { ListProjectAssets } from '../application/list-project-assets.js';
import { throwAssetHttpError } from './asset-http-errors.js';
import { CreateAssetUploadUrlDto } from './asset.dto.js';
import { KeysetPageDto } from '../../tenancy/http/keyset-page.dto.js';

@Controller({
  path: 'teams/:teamId/story-projects/:projectId/assets',
  version: '1',
})
@UseGuards(SessionAuthGuard, TenantContextGuard)
export class AssetsController {
  constructor(
    @Inject(CreateAssetUploadUrl)
    private readonly createUploadUrl: CreateAssetUploadUrl,
    @Inject(CompleteAssetUpload)
    private readonly completeUpload: CompleteAssetUpload,
    @Inject(ListProjectAssets)
    private readonly listAssets: ListProjectAssets,
    @Inject(CreateAssetDownloadUrl)
    private readonly createDownloadUrl: CreateAssetDownloadUrl,
    @Inject(DeleteAsset)
    private readonly deleteAsset: DeleteAsset,
  ) {}

  @Post('upload-url')
  async createUpload(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body(
      new ValidationPipe({
        expectedType: CreateAssetUploadUrlDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: CreateAssetUploadUrlDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.createUploadUrl.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        fileName: body.fileName,
        contentType: body.contentType,
        byteSize: body.byteSize,
      });
    } catch (error) {
      throwAssetHttpError(error);
    }
  }

  @Post(':assetId/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.completeUpload.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        assetId,
      });
    } catch (error) {
      throwAssetHttpError(error);
    }
  }

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
        await this.listAssets.execute({
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          projectId,
          page: readKeysetPage(query),
        }),
      );
    } catch (error) {
      throwAssetHttpError(error);
    }
  }

  @Delete(':assetId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.deleteAsset.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        assetId,
      });
    } catch (error) {
      throwAssetHttpError(error);
    }
  }

  @Get(':assetId/download-url')
  async download(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.createDownloadUrl.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        assetId,
      });
    } catch (error) {
      throwAssetHttpError(error);
    }
  }
}
