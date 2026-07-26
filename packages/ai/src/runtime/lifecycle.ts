import { AiRuntimeError } from '../core/errors.js';

export interface RuntimeOperationLease {
  readonly signal: AbortSignal;
  release(): void;
}

export interface RuntimeDisposeOptions {
  readonly timeoutMs?: number;
  readonly onTimeout?: 'abort' | 'error';
}

export interface RuntimeLifecycle {
  assertRunning(): void;
  acquire(abort?: () => void): RuntimeOperationLease;
  dispose(
    options: RuntimeDisposeOptions | undefined,
    cleanup: () => Promise<void>,
  ): Promise<void>;
}

type RuntimeState = 'running' | 'draining' | 'disposing' | 'disposed';

export function createRuntimeLifecycle(): RuntimeLifecycle {
  let state: RuntimeState = 'running';
  let nextOperationId = 0;
  let disposal: Promise<void> | undefined;
  const operations = new Map<
    number,
    Readonly<{ controller: AbortController; abort?: () => void }>
  >();
  const idleWaiters = new Set<() => void>();

  const assertRunning = (): void => {
    if (state === 'running') return;
    throw new AiRuntimeError(
      state === 'disposed' ? 'RUNTIME_DISPOSED' : 'RUNTIME_DRAINING',
      'invalid_request',
      state === 'disposed' ? 'runtime is disposed' : 'runtime is draining',
    );
  };

  const acquire = (abort?: () => void): RuntimeOperationLease => {
    assertRunning();
    const operationId = ++nextOperationId;
    const controller = new AbortController();
    operations.set(operationId, {
      controller,
      ...(abort ? { abort } : {}),
    });
    let released = false;
    return Object.freeze({
      signal: controller.signal,
      release: () => {
        if (released) return;
        released = true;
        operations.delete(operationId);
        if (operations.size === 0) {
          for (const resolve of idleWaiters) resolve();
          idleWaiters.clear();
        }
      },
    });
  };

  const waitForIdle = (): Promise<void> =>
    operations.size === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          idleWaiters.add(resolve);
        });

  const abortOperations = (): void => {
    const error = new AiRuntimeError(
      'RUNTIME_DISPOSE_TIMEOUT',
      'timeout',
      'runtime disposal timed out',
    );
    for (const operation of [...operations.values()]) {
      if (!operation.controller.signal.aborted)
        operation.controller.abort(error);
      try {
        operation.abort?.();
      } catch {
        // Abort is best-effort; the operation still receives its owned signal.
      }
    }
  };

  const forceReleaseOperations = (): void => {
    operations.clear();
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };

  const dispose = (
    options: RuntimeDisposeOptions | undefined,
    cleanup: () => Promise<void>,
  ): Promise<void> => {
    if (state === 'disposed') return Promise.resolve();
    if (disposal) return disposal;
    try {
      validateDisposeOptions(options);
    } catch (error) {
      return Promise.reject(error);
    }
    if (state === 'running') state = 'draining';
    disposal = (async () => {
      const drained = await waitForIdleWithTimeout(
        waitForIdle,
        options?.timeoutMs,
      );
      if (!drained) {
        if (options?.onTimeout === 'error')
          throw new AiRuntimeError(
            'RUNTIME_DISPOSE_TIMEOUT',
            'timeout',
            'runtime disposal timed out',
          );
        abortOperations();
        const aborted = await waitForIdleWithTimeout(
          waitForIdle,
          options?.timeoutMs,
        );
        if (!aborted) forceReleaseOperations();
      }
      state = 'disposing';
      try {
        await cleanup();
      } finally {
        state = 'disposed';
      }
    })().catch((error: unknown) => {
      if (state === 'draining') disposal = undefined;
      throw error;
    });
    return disposal;
  };

  return Object.freeze({ assertRunning, acquire, dispose });
}

function validateDisposeOptions(options: RuntimeDisposeOptions | undefined) {
  if (
    options?.timeoutMs !== undefined &&
    (!Number.isInteger(options.timeoutMs) ||
      !Number.isFinite(options.timeoutMs) ||
      options.timeoutMs <= 0)
  )
    throw new AiRuntimeError(
      'RUNTIME_DISPOSE_OPTIONS_INVALID',
      'invalid_request',
      'dispose timeoutMs must be a positive finite integer',
    );
  if (
    options?.onTimeout !== undefined &&
    options.onTimeout !== 'abort' &&
    options.onTimeout !== 'error'
  )
    throw new AiRuntimeError(
      'RUNTIME_DISPOSE_OPTIONS_INVALID',
      'invalid_request',
      'dispose onTimeout must be abort or error',
    );
}

async function waitForIdleWithTimeout(
  waitForIdle: () => Promise<void>,
  timeoutMs: number | undefined,
): Promise<boolean> {
  if (timeoutMs === undefined) {
    await waitForIdle();
    return true;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      waitForIdle().then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
