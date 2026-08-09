import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';

import { ApplicationError } from '../../../platform/http/application-error.js';
import { readAuthenticatedSession } from '../../identity/http/session-auth.guard.js';
import {
  TEAM_MEMBERSHIP_REPOSITORY,
  type TeamMembershipRepository,
} from '../ports/team-membership-repository.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_CONTEXT = Symbol('TENANT_CONTEXT');

export interface TenantContext {
  readonly tenantId: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly role: 'admin' | 'member';
}

type TenantRequest = {
  params?: Record<string, unknown>;
  [TENANT_CONTEXT]?: TenantContext;
};

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    @Inject(TEAM_MEMBERSHIP_REPOSITORY)
    private readonly memberships: TeamMembershipRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const teamId = request.params?.teamId;
    if (typeof teamId !== 'string' || !UUID_PATTERN.test(teamId)) {
      throw teamNotFound();
    }

    const authenticated = readAuthenticatedSession(request);
    const membership = await this.memberships.findActive({
      tenantId: teamId,
      userId: authenticated.userId,
    });
    if (membership === null) {
      throw teamNotFound();
    }

    request[TENANT_CONTEXT] = Object.freeze({
      tenantId: membership.tenantId,
      membershipId: membership.id,
      userId: membership.userId,
      role: membership.role,
    });
    return true;
  }
}

export function readTenantContext(request: object): TenantContext {
  const tenant = (request as TenantRequest)[TENANT_CONTEXT];
  if (tenant === undefined) {
    throw new Error('Tenant context is unavailable');
  }
  return tenant;
}

function teamNotFound(): ApplicationError {
  return new ApplicationError({
    code: 'TEAM_NOT_FOUND',
    message: 'Team not found',
    statusCode: HttpStatus.NOT_FOUND,
  });
}
