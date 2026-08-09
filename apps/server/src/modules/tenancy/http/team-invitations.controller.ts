import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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

import { readIdempotencyKey } from '../../../platform/http/idempotency-key.js';
import {
  keysetPageResponse,
  readKeysetPage,
} from '../../../platform/http/keyset-page.js';
import { readRequestId } from '../../../platform/http/request-id.middleware.js';
import { SessionAuthGuard } from '../../identity/http/session-auth.guard.js';
import { CreateTeamInvitation } from '../application/create-team-invitation.js';
import { ListTeamInvitations } from '../application/list-team-invitations.js';
import { RevokeTeamInvitation } from '../application/revoke-team-invitation.js';
import { KeysetPageDto } from './keyset-page.dto.js';
import { CreateTeamInvitationDto } from './team-lifecycle.dto.js';
import {
  readTenantContext,
  TenantContextGuard,
} from './tenant-context.guard.js';
import { throwTenancyHttpError } from './tenancy-http-errors.js';

@Controller({ path: 'teams/:teamId/invitations', version: '1' })
@UseGuards(SessionAuthGuard, TenantContextGuard)
export class TeamInvitationsController {
  constructor(
    @Inject(CreateTeamInvitation)
    private readonly createInvitation: CreateTeamInvitation,
    @Inject(ListTeamInvitations)
    private readonly listInvitations: ListTeamInvitations,
    @Inject(RevokeTeamInvitation)
    private readonly revokeInvitation: RevokeTeamInvitation,
  ) {}

  @Post()
  async create(
    @Body() body: CreateTeamInvitationDto,
    @Headers('idempotency-key') suppliedIdempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.createInvitation.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        email: body.email,
        idempotencyKey: readIdempotencyKey(suppliedIdempotencyKey),
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwTenancyHttpError(error);
    }
  }

  @Get()
  async list(
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
        await this.listInvitations.execute({
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          page: readKeysetPage(query),
        }),
      );
    } catch (error) {
      throwTenancyHttpError(error);
    }
  }

  @Delete(':invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('invitationId', new ParseUUIDPipe({ version: '4' }))
    invitationId: string,
    @Req() request: Request,
  ): Promise<void> {
    const tenant = readTenantContext(request);
    try {
      await this.revokeInvitation.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        invitationId,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwTenancyHttpError(error);
    }
  }
}
