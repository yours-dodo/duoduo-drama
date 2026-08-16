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
import { CreateStoryConversation } from '../application/create-story-conversation.js';
import { CreateStoryConversationDto } from './story-conversation.dto.js';
import { throwStoryHttpError } from './story-http-errors.js';

@Controller({
  path: 'me/story-projects/:projectId/conversations',
  version: '1',
})
@UseGuards(SessionAuthGuard)
export class MeStoryConversationsController {
  constructor(
    @Inject(CreateStoryConversation)
    private readonly createConversation: CreateStoryConversation,
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
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Headers('idempotency-key') suppliedIdempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    const session = readAuthenticatedSession(request);
    try {
      return await this.createConversation.execute({
        tenantId: null,
        actorUserId: session.userId,
        projectId,
        title: body.title,
        idempotencyKey: readIdempotencyKey(suppliedIdempotencyKey),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }
}
