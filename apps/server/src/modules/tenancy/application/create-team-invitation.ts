import { EmailAddress } from '../../../domain/identity/email-address.js';
import {
  TeamInvitation,
  type TeamInvitationSnapshot,
} from '../../../domain/tenancy/team-invitation.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { IdempotencyConflictError } from './create-team.js';
import {
  TeamAdministratorRequiredError,
  TeamInvitationAlreadyPendingError,
  TeamMemberAlreadyActiveError,
} from './tenancy-errors.js';
import type { IdempotencyRepository } from '../ports/idempotency-repository.js';
import type { TeamInvitationDelivery } from '../ports/team-invitation-delivery.js';
import type { TeamInvitationRepository } from '../ports/team-invitation-repository.js';
import type { TeamInvitationSecurity } from '../ports/team-invitation-security.js';
import type { TeamMembershipRepository } from '../ports/team-membership-repository.js';

export { IdempotencyConflictError } from './create-team.js';

const OPERATION_TYPE = 'CREATE_TEAM_INVITATION';
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export interface CreateTeamInvitationInput {
  tenantId: string;
  actorUserId: string;
  email: string;
  idempotencyKey: string;
  requestId: string;
}

export interface TeamInvitationOutput {
  invitation: {
    id: string;
    email: string;
    status: 'pending' | 'expired' | 'accepted' | 'revoked';
    expiresAt: Date;
    createdAt: Date;
  };
}

export class CreateTeamInvitation {
  constructor(
    private readonly memberships: TeamMembershipRepository,
    private readonly invitations: TeamInvitationRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly audit: AuditRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly fingerprint: { hash(value: string): string },
    private readonly security: TeamInvitationSecurity,
    private readonly delivery: TeamInvitationDelivery,
    private readonly ids: { create(): string },
  ) {}

  async execute(
    input: CreateTeamInvitationInput,
  ): Promise<TeamInvitationOutput> {
    const email = EmailAddress.parse(input.email).value;
    const scopeKey = `tenant:${input.tenantId}:user:${input.actorUserId}`;
    const requestHash = this.fingerprint.hash(JSON.stringify({ email }));
    const token = this.security.issueToken();
    const tokenHash = this.security.hashToken(token);

    const result = await this.transactions.run(async () => {
      await this.memberships.lockAdministration(input.tenantId);
      const actor = await this.memberships.findActive({
        tenantId: input.tenantId,
        userId: input.actorUserId,
      });
      if (actor?.role !== 'admin') {
        throw new TeamAdministratorRequiredError();
      }

      const now = await this.databaseClock.now();

      const existingResult = await this.idempotency.findLocked({
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
      });
      if (existingResult !== null) {
        if (existingResult.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }

        const existingInvitation = await this.invitations.findById({
          tenantId: input.tenantId,
          invitationId: existingResult.resultId,
        });
        if (existingInvitation === null) {
          throw new Error('Idempotency result invitation is unavailable');
        }

        return { output: outputFor(existingInvitation, now), delivery: null };
      }

      if (
        (await this.memberships.findActiveByEmail({
          tenantId: input.tenantId,
          email,
        })) !== null
      ) {
        throw new TeamMemberAlreadyActiveError();
      }

      const pending = await this.invitations.findPendingByEmailLocked({
        tenantId: input.tenantId,
        email,
      });
      if (pending !== null) {
        if (pending.expiresAt > now) {
          throw new TeamInvitationAlreadyPendingError();
        }
        const expired = TeamInvitation.restore(pending);
        expired.revoke(now);
        await this.invitations.update(expired.toSnapshot());
      }

      const invitation = TeamInvitation.issue({
        id: this.ids.create(),
        tenantId: input.tenantId,
        email,
        invitedByUserId: input.actorUserId,
        tokenHash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
      }).toSnapshot();
      await this.invitations.create(invitation);
      await this.idempotency.create({
        id: this.ids.create(),
        tenantId: input.tenantId,
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        resultId: invitation.id,
        createdAt: now,
      });
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'TEAM_INVITATION_CREATED',
        targetType: 'TEAM_INVITATION',
        targetId: invitation.id,
        beforeSummary: null,
        afterSummary: { email: invitation.email },
        requestId: input.requestId,
        occurredAt: now,
      });

      return {
        output: outputFor(invitation, now),
        delivery: {
          email: invitation.email,
          tenantId: invitation.tenantId,
          token,
          expiresAt: invitation.expiresAt,
        },
      };
    });

    if (result.delivery !== null) {
      await this.delivery.deliver(result.delivery);
    }
    return result.output;
  }
}

export function invitationStatus(
  invitation: TeamInvitationSnapshot,
  now: Date,
): TeamInvitationOutput['invitation']['status'] {
  if (invitation.acceptedAt !== null) return 'accepted';
  if (invitation.revokedAt !== null) return 'revoked';
  if (invitation.expiresAt <= now) return 'expired';
  return 'pending';
}

function outputFor(
  invitation: TeamInvitationSnapshot,
  now: Date,
): TeamInvitationOutput {
  return {
    invitation: {
      id: invitation.id,
      email: invitation.email,
      status: invitationStatus(invitation, now),
      expiresAt: new Date(invitation.expiresAt),
      createdAt: new Date(invitation.createdAt),
    },
  };
}
