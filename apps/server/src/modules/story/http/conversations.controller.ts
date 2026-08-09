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
import { SessionAuthGuard } from '../../identity/http/session-auth.guard.js';
import { KeysetPageDto } from '../../tenancy/http/keyset-page.dto.js';
import {
  readTenantContext,
  TenantContextGuard,
} from '../../tenancy/http/tenant-context.guard.js';
import { ArchiveStoryConversation } from '../application/archive-story-conversation.js';
import { CreateStoryConversation } from '../application/create-story-conversation.js';
import { ListStoryConversations } from '../application/list-story-conversations.js';
import { UpdateStoryConversation } from '../application/update-story-conversation.js';
import {
  ArchiveStoryConversationDto,
  CreateStoryConversationDto,
  UpdateStoryConversationDto,
} from './story-conversation.dto.js';
import { throwStoryHttpError } from './story-http-errors.js';

@Controller({
  path: 'teams/:teamId/story-projects/:projectId/conversations',
  version: '1',
})
@UseGuards(SessionAuthGuard, TenantContextGuard)
export class ConversationsController {
  constructor(
    @Inject(CreateStoryConversation)
    private readonly createConversation: CreateStoryConversation,
    @Inject(ListStoryConversations)
    private readonly listConversations: ListStoryConversations,
    @Inject(UpdateStoryConversation)
    private readonly updateConversation: UpdateStoryConversation,
    @Inject(ArchiveStoryConversation)
    private readonly archiveConversation: ArchiveStoryConversation,
  ) {}

  @Post()
  async create(
    @Body(
      new ValidationPipe({
        expectedType: CreateStoryConversationDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: CreateStoryConversationDto,
    @Headers('idempotency-key') suppliedIdempotencyKey: string | undefined,
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.createConversation.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        title: body.title,
        idempotencyKey: readIdempotencyKey(suppliedIdempotencyKey),
      });
    } catch (error) {
      throwStoryHttpError(error);
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
        await this.listConversations.execute({
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

  @Patch(':conversationId')
  async update(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('conversationId', new ParseUUIDPipe({ version: '4' }))
    conversationId: string,
    @Body(
      new ValidationPipe({
        expectedType: UpdateStoryConversationDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: UpdateStoryConversationDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.updateConversation.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        conversationId,
        title: body.title,
        expectedRevision: body.expectedRevision,
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Post(':conversationId/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('conversationId', new ParseUUIDPipe({ version: '4' }))
    conversationId: string,
    @Body(
      new ValidationPipe({
        expectedType: ArchiveStoryConversationDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: ArchiveStoryConversationDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.archiveConversation.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        conversationId,
        expectedRevision: body.expectedRevision,
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }
}
