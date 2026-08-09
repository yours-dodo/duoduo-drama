const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;
const LOCAL_PART_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export class InvalidEmailAddressError extends Error {
  constructor() {
    super('Email address is invalid');
    this.name = 'InvalidEmailAddressError';
  }
}

export class EmailAddress {
  private constructor(readonly value: string) {}

  static parse(input: string): EmailAddress {
    const normalized = input.trim().toLowerCase();

    if (!isValidEmailAddress(normalized)) {
      throw new InvalidEmailAddressError();
    }

    return new EmailAddress(normalized);
  }
}

function isValidEmailAddress(value: string): boolean {
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) {
    return false;
  }

  const parts = value.split('@');
  if (parts.length !== 2) {
    return false;
  }

  const [localPart = '', domain = ''] = parts;
  if (
    localPart.length === 0 ||
    localPart.length > MAX_LOCAL_PART_LENGTH ||
    !LOCAL_PART_PATTERN.test(localPart) ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..')
  ) {
    return false;
  }

  const labels = domain.split('.');
  return (
    labels.length >= 2 &&
    (labels.at(-1)?.length ?? 0) >= 2 &&
    labels.every((label) => DOMAIN_LABEL_PATTERN.test(label))
  );
}
