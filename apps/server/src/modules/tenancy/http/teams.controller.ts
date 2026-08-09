import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';

import { ApplicationError } from '../../../platform/http/application-error.js';
import { readIdempotencyKey } from '../../../platform/http/idempotency-key.js';
import { readRequestId } from '../../../platform/http/request-id.middleware.js';
import {
  readAuthenticatedSession,
  SessionAuthGuard,
} from '../../identity/http/session-auth.guard.js';
import {
  CreateTeam,
  IdempotencyConflictError,
  type CreateTeamOutput,
} from '../application/create-team.js';
import { ListMyTeams } from '../application/list-my-teams.js';
import { CreateTeamDto } from './create-team.dto.js';

@Controller({ path: 'teams', version: '1' })
@UseGuards(SessionAuthGuard)
export class TeamsController {
  constructor(
    @Inject(CreateTeam) private readonly createTeam: CreateTeam,
    @Inject(ListMyTeams) private readonly listMyTeams: ListMyTeams,
  ) {}

  @Post()
  async create(
    @Body(
      new ValidationPipe({
        expectedType: CreateTeamDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: CreateTeamDto,
    @Headers('idempotency-key') suppliedIdempotencyKey: string | undefined,
    @Req() request: Request,
  ): Promise<CreateTeamOutput> {
    const idempotencyKey = readIdempotencyKey(suppliedIdempotencyKey);
    const authenticated = readAuthenticatedSession(request);

    try {
      return await this.createTeam.execute({
        actorUserId: authenticated.userId,
        name: body.name,
        idempotencyKey,
        requestId: readRequestId(request),
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ApplicationError({
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: 'The idempotency key was used with different input',
          statusCode: HttpStatus.CONFLICT,
        });
      }
      throw error;
    }
  }

  @Get()
  list(@Req() request: Request) {
    const authenticated = readAuthenticatedSession(request);
    return this.listMyTeams.execute({ userId: authenticated.userId });
  }
}
