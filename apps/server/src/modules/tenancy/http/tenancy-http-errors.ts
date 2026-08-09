import { HttpStatus } from '@nestjs/common';

import { LastTeamAdministratorError } from '../../../domain/tenancy/team-membership.js';
import { ApplicationError } from '../../../platform/http/application-error.js';
import { IdempotencyConflictError } from '../application/create-team.js';
import {
  TeamAdministratorRequiredError,
  TeamInvitationAlreadyPendingError,
  TeamInvitationCannotBeRevokedError,
  TeamInvitationNotFoundError,
  TeamMemberAlreadyActiveError,
  TeamMemberNotFoundError,
} from '../application/tenancy-errors.js';

export function throwTenancyHttpError(error: unknown): never {
  if (error instanceof TeamAdministratorRequiredError) {
    throw applicationError(
      'TEAM_ADMINISTRATOR_REQUIRED',
      'Team administrator access is required',
      HttpStatus.FORBIDDEN,
    );
  }
  if (error instanceof TeamInvitationNotFoundError) {
    throw applicationError(
      'TEAM_INVITATION_NOT_FOUND',
      'Team invitation not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof TeamMemberNotFoundError) {
    throw applicationError(
      'TEAM_MEMBER_NOT_FOUND',
      'Team member not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof LastTeamAdministratorError) {
    throw applicationError(
      'LAST_TEAM_ADMINISTRATOR',
      'A team must retain an administrator',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof TeamInvitationAlreadyPendingError) {
    throw applicationError(
      'TEAM_INVITATION_ALREADY_PENDING',
      'An active invitation already exists for this email',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof TeamMemberAlreadyActiveError) {
    throw applicationError(
      'TEAM_MEMBER_ALREADY_ACTIVE',
      'The user is already an active team member',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof TeamInvitationCannotBeRevokedError) {
    throw applicationError(
      'TEAM_INVITATION_CANNOT_BE_REVOKED',
      'The invitation cannot be revoked',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof IdempotencyConflictError) {
    throw applicationError(
      'IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key was used with different input',
      HttpStatus.CONFLICT,
    );
  }
  throw error;
}

function applicationError(
  code: string,
  message: string,
  statusCode: number,
): ApplicationError {
  return new ApplicationError({ code, message, statusCode });
}
