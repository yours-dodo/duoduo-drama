import { describe, expect, it } from 'vitest';

import { EmailAddress, InvalidEmailAddressError } from './email-address.js';

describe('EmailAddress', () => {
  it('normalizes surrounding whitespace and letter casing', () => {
    expect(EmailAddress.parse('  Writer.Name+Drama@Example.COM  ').value).toBe(
      'writer.name+drama@example.com',
    );
  });

  it.each([
    '',
    'writer',
    '@example.com',
    'writer@',
    'writer@example',
    '.writer@example.com',
    'writer..name@example.com',
    'writer@-example.com',
    `${'a'.repeat(65)}@example.com`,
  ])('rejects an invalid address: %s', (input) => {
    expect(() => EmailAddress.parse(input)).toThrow(InvalidEmailAddressError);
  });
});
