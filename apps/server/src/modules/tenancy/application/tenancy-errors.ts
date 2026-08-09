export class TeamAdministratorRequiredError extends Error {
  constructor() {
    super('Team administrator access is required');
    this.name = 'TeamAdministratorRequiredError';
  }
}

export class TeamInvitationAlreadyPendingError extends Error {
  constructor() {
    super('An active invitation already exists for this email');
    this.name = 'TeamInvitationAlreadyPendingError';
  }
}

export class TeamInvitationNotFoundError extends Error {
  constructor() {
    super('Team invitation was not found');
    this.name = 'TeamInvitationNotFoundError';
  }
}

export class TeamInvitationCannotBeRevokedError extends Error {
  constructor() {
    super('Team invitation cannot be revoked');
    this.name = 'TeamInvitationCannotBeRevokedError';
  }
}

export class TeamMemberAlreadyActiveError extends Error {
  constructor() {
    super('The user is already an active team member');
    this.name = 'TeamMemberAlreadyActiveError';
  }
}

export class TeamMemberNotFoundError extends Error {
  constructor() {
    super('Team member was not found');
    this.name = 'TeamMemberNotFoundError';
  }
}
