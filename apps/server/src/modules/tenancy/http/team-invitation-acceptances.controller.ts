import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { readRequestId } from '../../../platform/http/request-id.middleware.js';
import {
  readAuthenticatedSession,
  SessionAuthGuard,
} from '../../identity/http/session-auth.guard.js';
import { AcceptTeamInvitation } from '../application/accept-team-invitation.js';
import { AcceptTeamInvitationDto } from './team-lifecycle.dto.js';
import { throwTenancyHttpError } from './tenancy-http-errors.js';

@Controller({ path: 'team-invitation-acceptances', version: '1' })
@UseGuards(SessionAuthGuard)
export class TeamInvitationAcceptancesController {
  constructor(
    @Inject(AcceptTeamInvitation)
    private readonly acceptInvitation: AcceptTeamInvitation,
  ) {}

  @Post()
  async accept(@Body() body: AcceptTeamInvitationDto, @Req() request: Request) {
    const authenticated = readAuthenticatedSession(request);
    try {
      return await this.acceptInvitation.execute({
        actorUserId: authenticated.userId,
        actorEmail: authenticated.email,
        token: body.token,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwTenancyHttpError(error);
    }
  }
}
