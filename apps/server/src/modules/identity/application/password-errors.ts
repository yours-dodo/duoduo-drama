export class InvalidPasswordCredentialsError extends Error {
  constructor() {
    super('Password credentials are invalid');
    this.name = 'InvalidPasswordCredentialsError';
  }
}

export class InvalidEmailVerificationCodeError extends Error {
  constructor() {
    super('Email verification code is invalid or expired');
    this.name = 'InvalidEmailVerificationCodeError';
  }
}

export class InvalidPasswordError extends Error {
  constructor() {
    super('Password does not meet the required policy');
    this.name = 'InvalidPasswordError';
  }
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function assertPasswordPolicy(password: string): void {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new InvalidPasswordError();
  }
}
