export interface RuntimeResourcePolicyInput {
  readonly streamQueue?: Readonly<{
    readonly maxEvents?: number;
    readonly maxBytes?: number;
  }>;
  readonly session?: Readonly<{
    readonly idleTtlMs?: number;
    readonly maxSessions?: number;
    readonly maxResourcesPerSession?: number;
  }>;
}

export interface RuntimeResourcePolicy {
  readonly streamQueue: Readonly<{
    readonly maxEvents: number;
    readonly maxBytes: number;
  }>;
  readonly session: Readonly<{
    readonly idleTtlMs: number;
    readonly maxSessions: number;
    readonly maxResourcesPerSession: number;
  }>;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const KIBIBYTE = 1_024;
const MEBIBYTE = 1_024 * KIBIBYTE;

export const DEFAULT_RUNTIME_RESOURCE_POLICY: RuntimeResourcePolicy =
  deepFreezePolicy({
    streamQueue: {
      maxEvents: 256,
      maxBytes: 4 * MEBIBYTE,
    },
    session: {
      idleTtlMs: 15 * MINUTE,
      maxSessions: 1_000,
      maxResourcesPerSession: 64,
    },
  });

export function resolveRuntimeResourcePolicy(
  input: RuntimeResourcePolicyInput = {},
): RuntimeResourcePolicy {
  if ('catalog' in input)
    throw new TypeError(
      'runtime resourcePolicy.catalog is not supported because model catalogs are statically registered',
    );

  return deepFreezePolicy({
    streamQueue: {
      maxEvents: integerInRange(
        'streamQueue.maxEvents',
        input.streamQueue?.maxEvents ??
          DEFAULT_RUNTIME_RESOURCE_POLICY.streamQueue.maxEvents,
        8,
        4_096,
      ),
      maxBytes: integerInRange(
        'streamQueue.maxBytes',
        input.streamQueue?.maxBytes ??
          DEFAULT_RUNTIME_RESOURCE_POLICY.streamQueue.maxBytes,
        64 * KIBIBYTE,
        32 * MEBIBYTE,
      ),
    },
    session: {
      idleTtlMs: integerInRange(
        'session.idleTtlMs',
        input.session?.idleTtlMs ??
          DEFAULT_RUNTIME_RESOURCE_POLICY.session.idleTtlMs,
        MINUTE,
        DAY,
      ),
      maxSessions: integerInRange(
        'session.maxSessions',
        input.session?.maxSessions ??
          DEFAULT_RUNTIME_RESOURCE_POLICY.session.maxSessions,
        1,
        10_000,
      ),
      maxResourcesPerSession: integerInRange(
        'session.maxResourcesPerSession',
        input.session?.maxResourcesPerSession ??
          DEFAULT_RUNTIME_RESOURCE_POLICY.session.maxResourcesPerSession,
        1,
        256,
      ),
    },
  });
}

function integerInRange(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new TypeError(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  return value;
}

function deepFreezePolicy(
  policy: RuntimeResourcePolicy,
): RuntimeResourcePolicy {
  Object.freeze(policy.streamQueue);
  Object.freeze(policy.session);
  return Object.freeze(policy);
}
