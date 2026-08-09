import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import {
  readAuthenticatedSession,
  SessionAuthGuard,
} from '../../identity/http/session-auth.guard.js';
import { ListMyTeams } from '../application/list-my-teams.js';

@Controller({ path: 'me', version: '1' })
@UseGuards(SessionAuthGuard)
export class MeController {
  constructor(@Inject(ListMyTeams) private readonly listMyTeams: ListMyTeams) {}

  @Get()
  async read(@Req() request: Request) {
    const authenticated = readAuthenticatedSession(request);
    const { teams } = await this.listMyTeams.execute({
      userId: authenticated.userId,
    });

    return {
      user: {
        id: authenticated.userId,
        email: authenticated.email,
      },
      session: { expiresAt: new Date(authenticated.expiresAt) },
      teams,
    };
  }
}
