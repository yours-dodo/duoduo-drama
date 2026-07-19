import { AiRuntimeError } from '../core/errors.js';
import type { NetworkPolicy } from './types.js';

export function createAllowlistNetworkPolicy(input: {
  readonly origins: readonly string[];
}): NetworkPolicy {
  const origins = new Set(input.origins.map(normalizeOrigin));
  return {
    authorize: async ({ url }, signal) => {
      if (signal.aborted)
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      if (
        url.username ||
        url.password ||
        url.hash ||
        !origins.has(url.origin)
      ) {
        throw new AiRuntimeError(
          'NETWORK_POLICY_DENIED',
          'invalid_request',
          'network target is not allowed',
          false,
          { origin: url.origin },
        );
      }
    },
  };
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new TypeError(`invalid HTTPS origin: ${value}`);
  }
  return url.origin;
}
