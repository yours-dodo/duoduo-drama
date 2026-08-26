import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';

import { readRequestId } from '../../../platform/http/request-id.middleware.js';
import { readIdempotencyKey } from '../../../platform/http/idempotency-key.js';
import {
  readAuthenticatedSession,
  SessionAuthGuard,
} from '../../identity/http/session-auth.guard.js';
import { GetStoryOutline } from '../application/get-story-outline.js';
import { SaveStoryOutline } from '../application/save-story-outline.js';
import { SaveStoryOutlineDto } from './story-artifact.dto.js';
import { throwStoryHttpError } from './story-http-errors.js';

@Controller({ path: 'me/story-projects/:projectId/outline', version: '1' })
@UseGuards(SessionAuthGuard)
export class MeStoryOutlineController {
  constructor(
    private readonly getOutline: GetStoryOutline,
    private readonly saveOutline: SaveStoryOutline,
  ) {}

  @Get()
  async get(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Req() request: Request,
  ) {
    const session = readAuthenticatedSession(request);
    try {
      return await this.getOutline.execute({
        tenantId: null,
        actorUserId: session.userId,
        projectId,
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }

  @Put()
  async save(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body(
      new ValidationPipe({
        expectedType: SaveStoryOutlineDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: SaveStoryOutlineDto,
    @Headers('idempotency-key') suppliedIdempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    const session = readAuthenticatedSession(request);
    try {
      return await this.saveOutline.execute({
        tenantId: null,
        actorUserId: session.userId,
        projectId,
        content: body.content,
        expectedVersionNumber: body.expectedVersionNumber,
        idempotencyKey: readIdempotencyKey(suppliedIdempotencyKey),
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }
}
