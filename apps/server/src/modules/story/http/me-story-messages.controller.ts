import {
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';

import { readIdempotencyKey } from '../../../platform/http/idempotency-key.js';
import {
  readAuthenticatedSession,
  SessionAuthGuard,
} from '../../identity/http/session-auth.guard.js';
import { AppendStoryMessage } from '../application/append-story-message.js';
import { GenerateStoryDraft } from '../application/generate-story-draft.js';
import { AppendStoryMessageDto } from './story-conversation.dto.js';
import { throwStoryHttpError } from './story-http-errors.js';

@Controller({
  path: 'me/story-projects/:projectId/conversations/:conversationId/messages',
  version: '1',
})
@UseGuards(SessionAuthGuard)
export class MeStoryMessagesController {
  constructor(
    @Inject(AppendStoryMessage)
    private readonly appendMessage: AppendStoryMessage,
    @Inject(GenerateStoryDraft)
    private readonly generateStory: GenerateStoryDraft,
  ) {}

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
    const session = readAuthenticatedSession(request);
    try {
      const appended = await this.appendMessage.execute({
        tenantId: null,
        actorUserId: session.userId,
        projectId,
        conversationId,
        body: body.body,
        idempotencyKey: readIdempotencyKey(suppliedIdempotencyKey),
      });
      const generated = await this.generateStory.execute({
        tenantId: null,
        actorUserId: session.userId,
        projectId,
        conversationId,
        requestId: appended.generationRequest.id,
      });
      return {
        message: appended.message,
        generationRequest: generated.generationRequest,
        assistantMessage: generated.message,
        artifact: generated.artifact,
        artifactVersion: generated.artifactVersion,
      };
    } catch (error) {
      throwStoryHttpError(error);
    }
  }
}
