import {
  Body,
  Controller,
  Get,
  Headers,
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
import { readIdempotencyKey } from '../../../platform/http/idempotency-key.js';
import { SessionAuthGuard } from '../../identity/http/session-auth.guard.js';
import { KeysetPageDto } from '../../tenancy/http/keyset-page.dto.js';
import {
  readTenantContext,
  TenantContextGuard,
} from '../../tenancy/http/tenant-context.guard.js';
import { AppendStoryMessage } from '../application/append-story-message.js';
import { GenerateStoryDraft } from '../application/generate-story-draft.js';
import { ListConversationMessages } from '../application/list-conversation-messages.js';
import { AppendStoryMessageDto } from './story-conversation.dto.js';
import { throwStoryHttpError } from './story-http-errors.js';

@Controller({
  path: 'teams/:teamId/story-projects/:projectId/conversations/:conversationId/messages',
  version: '1',
})
@UseGuards(SessionAuthGuard, TenantContextGuard)
export class MessagesController {
  constructor(
    @Inject(ListConversationMessages)
    private readonly listMessages: ListConversationMessages,
    @Inject(AppendStoryMessage)
    private readonly appendMessage: AppendStoryMessage,
    @Inject(GenerateStoryDraft)
    private readonly generateStory: GenerateStoryDraft,
  ) {}

  @Get()
  async list(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('conversationId', new ParseUUIDPipe({ version: '4' }))
    conversationId: string,
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
        await this.listMessages.execute({
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          projectId,
          conversationId,
          page: readKeysetPage(query),
        }),
      );
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Post()
  async append(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('conversationId', new ParseUUIDPipe({ version: '4' }))
    conversationId: string,
    @Body(
      new ValidationPipe({
        expectedType: AppendStoryMessageDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: AppendStoryMessageDto,
    @Headers('idempotency-key') suppliedIdempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      const appended = await this.appendMessage.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        projectId,
        conversationId,
        body: body.body,
        idempotencyKey: readIdempotencyKey(suppliedIdempotencyKey),
      });
      // Kick off the Agent pipeline without blocking the request; the client
      // polls the generation request until it succeeds or fails.
      void this.generateStory
        .execute({
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          projectId,
          conversationId,
          requestId: appended.generationRequest.id,
        })
        .catch(() => undefined);
      return {
        message: appended.message,
        generationRequest: appended.generationRequest,
      };
    } catch (error) {
      throwStoryHttpError(error);
    }
  }
}
