const secretValues = new WeakMap<object, string>();

declare const secretValueBrand: unique symbol;

export interface SecretValue {
  readonly [secretValueBrand]: true;
  toString(): '[REDACTED]';
  toJSON(): '[REDACTED]';
}

class RedactedSecretValue implements SecretValue {
  declare readonly [secretValueBrand]: true;

  constructor(value: string) {
    secretValues.set(this, value);
    Object.freeze(this);
  }

  toString(): '[REDACTED]' {
    return '[REDACTED]';
  }

  toJSON(): '[REDACTED]' {
    return '[REDACTED]';
  }
}

export function secret(value: string): SecretValue {
  if (value.length === 0) throw new TypeError('secret value must not be empty');
  return new RedactedSecretValue(value);
}

/** Package-internal materialization seam. Never export from a public entrypoint. */
export function revealSecret(value: SecretValue): string {
  const revealed = secretValues.get(value as object);
  if (revealed === undefined) throw new TypeError('invalid SecretValue');
  return revealed;
}
