import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import {
  readAuthenticatedSession,
  SessionAuthGuard,
} from './session-auth.guard.js';

export interface CurrentUserResponse {
  user: { id: string; email: string };
  session: { expiresAt: Date };
}

@Controller({ path: 'me', version: '1' })
@UseGuards(SessionAuthGuard)
export class MeController {
  @Get()
  read(@Req() request: Request): CurrentUserResponse {
    const authenticated = readAuthenticatedSession(request);

    return {
      user: {
        id: authenticated.userId,
        email: authenticated.email,
      },
      session: { expiresAt: new Date(authenticated.expiresAt) },
    };
  }
}
