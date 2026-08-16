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
import { readRequestId } from '../../../platform/http/request-id.middleware.js';
import {
  readAuthenticatedSession,
  SessionAuthGuard,
} from '../../identity/http/session-auth.guard.js';
import { CreateStoryImportJob } from '../application/create-story-import-job.js';
import { throwStoryHttpError } from './story-http-errors.js';
import { CreateStoryImportJobDto } from './story-import-job.dto.js';

@Controller({ path: 'me/story-projects/:projectId/import-jobs', version: '1' })
@UseGuards(SessionAuthGuard)
export class MeStoryImportJobsController {
  constructor(
    @Inject(CreateStoryImportJob)
    private readonly createImportJob: CreateStoryImportJob,
  ) {}

  @Post()
  async create(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body(
      new ValidationPipe({
        expectedType: CreateStoryImportJobDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: CreateStoryImportJobDto,
    @Headers('idempotency-key') suppliedIdempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    const session = readAuthenticatedSession(request);
    try {
      return await this.createImportJob.execute({
        tenantId: null,
        actorUserId: session.userId,
        projectId,
        fileName: body.fileName,
        contentType: body.contentType,
        byteSize: body.byteSize,
        idempotencyKey: readIdempotencyKey(suppliedIdempotencyKey),
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwStoryHttpError(error);
    }
  }
}
