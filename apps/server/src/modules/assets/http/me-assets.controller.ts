import {
  Body,
  Controller,
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
import {
  readAuthenticatedSession,
  SessionAuthGuard,
} from '../../identity/http/session-auth.guard.js';
import { CompleteAssetUpload } from '../application/complete-asset-upload.js';
import { CreateAssetDownloadUrl } from '../application/create-asset-download-url.js';
import { CreateAssetUploadUrl } from '../application/create-asset-upload-url.js';
import { ListProjectAssets } from '../application/list-project-assets.js';
import { throwAssetHttpError } from './asset-http-errors.js';
import { CreateAssetUploadUrlDto } from './asset.dto.js';
import { KeysetPageDto } from '../../tenancy/http/keyset-page.dto.js';

@Controller({
  path: 'me/story-projects/:projectId/assets',
  version: '1',
})
@UseGuards(SessionAuthGuard)
export class MeAssetsController {
  constructor(
    @Inject(CreateAssetUploadUrl)
    private readonly createUploadUrl: CreateAssetUploadUrl,
    @Inject(CompleteAssetUpload)
    private readonly completeUpload: CompleteAssetUpload,
    @Inject(ListProjectAssets)
    private readonly listAssets: ListProjectAssets,
    @Inject(CreateAssetDownloadUrl)
    private readonly createDownloadUrl: CreateAssetDownloadUrl,
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
    return this.withSession(request, (userId) =>
      this.createUploadUrl.execute({
        tenantId: null,
        actorUserId: userId,
        projectId,
        fileName: body.fileName,
        contentType: body.contentType,
        byteSize: body.byteSize,
      }),
    );
  }

  @Post(':assetId/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Req() request: Request,
  ) {
    return this.withSession(request, (userId) =>
      this.completeUpload.execute({
        tenantId: null,
        actorUserId: userId,
        projectId,
        assetId,
      }),
    );
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
    return this.withSession(request, (userId) =>
      this.listAssets
        .execute({
          tenantId: null,
          actorUserId: userId,
          projectId,
          page: readKeysetPage(query),
        })
        .then(keysetPageResponse),
    );
  }

  @Get(':assetId/download-url')
  async download(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Req() request: Request,
  ) {
    return this.withSession(request, (userId) =>
      this.createDownloadUrl.execute({
        tenantId: null,
        actorUserId: userId,
        projectId,
        assetId,
      }),
    );
  }

  private async withSession<T>(
    request: Request,
    operation: (userId: string) => Promise<T>,
  ): Promise<T> {
    const session = readAuthenticatedSession(request);
    try {
      return await operation(session.userId);
    } catch (error) {
      throwAssetHttpError(error);
    }
  }
}
