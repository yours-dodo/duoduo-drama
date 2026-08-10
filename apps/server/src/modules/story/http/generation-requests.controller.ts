import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { SessionAuthGuard } from '../../identity/http/session-auth.guard.js';
import {
  readTenantContext,
  TenantContextGuard,
} from '../../tenancy/http/tenant-context.guard.js';
import { GenerateStoryDraft } from '../application/generate-story-draft.js';
import { RetryStoryGeneration } from '../application/retry-story-generation.js';
import { throwStoryHttpError } from './story-http-errors.js';

@Controller({
  path: 'teams/:teamId/story-projects/:projectId/conversations/:conversationId/generation-requests',
  version: '1',
})
@UseGuards(SessionAuthGuard, TenantContextGuard)
export class GenerationRequestsController {
  constructor(
    @Inject(GenerateStoryDraft)
    private readonly generate: GenerateStoryDraft,
    @Inject(RetryStoryGeneration)
    private readonly retry: RetryStoryGeneration,
  ) {}

  @Get(':requestId')
  async get(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('conversationId', new ParseUUIDPipe({ version: '4' }))
    conversationId: string,
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.generate.read({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        conversationId,
        requestId,
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Post(':requestId/retry')
  @HttpCode(HttpStatus.OK)
  async retryRequest(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('conversationId', new ParseUUIDPipe({ version: '4' }))
    conversationId: string,
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.retry.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        conversationId,
        requestId,
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }
}
