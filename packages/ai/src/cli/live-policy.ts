export type LiveCapability = 'chat' | 'images' | 'videos';

export interface LiveRunRequest {
  readonly provider: string;
  readonly model: string;
  readonly capability: LiveCapability;
  readonly allowPaid: boolean;
  readonly estimatedMaxUsd?: number;
  readonly requestedImages?: number;
  readonly requestedVideoSeconds?: number;
}

export type LiveRunDecision =
  | Readonly<{
      status: 'allowed';
      maxUsd: number;
      maxImages?: number;
      maxVideoSeconds?: number;
    }>
  | Readonly<{ status: 'skipped'; code: string; reason: string }>;

export function evaluateLiveRun(
  request: LiveRunRequest,
  environment: Readonly<Record<string, string | undefined>>,
): LiveRunDecision {
  if (environment.DUODUO_AI_LIVE !== '1')
    return skipped('LIVE_DISABLED', 'DUODUO_AI_LIVE=1 is required');
  if (!request.allowPaid)
    return skipped('PAID_OPT_IN_REQUIRED', '--allow-paid is required');
  const providers = new Set(
    (environment.DUODUO_AI_LIVE_PROVIDERS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!providers.has(request.provider))
    return skipped(
      'PROVIDER_NOT_ALLOWED',
      'provider is absent from DUODUO_AI_LIVE_PROVIDERS',
    );
  const maxUsd = positiveNumber(environment.DUODUO_AI_LIVE_MAX_USD);
  if (maxUsd === undefined)
    return skipped(
      'USD_BUDGET_REQUIRED',
      'a positive DUODUO_AI_LIVE_MAX_USD is required',
    );
  if (
    request.estimatedMaxUsd === undefined ||
    !Number.isFinite(request.estimatedMaxUsd) ||
    request.estimatedMaxUsd < 0
  )
    return skipped('COST_UNKNOWN', 'a finite cost estimate is required');
  if (request.estimatedMaxUsd > maxUsd)
    return skipped('USD_BUDGET_EXCEEDED', 'estimated cost exceeds budget');
  if (request.capability === 'images') {
    const maxImages = positiveInteger(environment.DUODUO_AI_LIVE_MAX_IMAGES);
    if (maxImages === undefined)
      return skipped(
        'IMAGE_BUDGET_REQUIRED',
        'DUODUO_AI_LIVE_MAX_IMAGES is required for image tests',
      );
    if ((request.requestedImages ?? 1) > maxImages)
      return skipped('IMAGE_BUDGET_EXCEEDED', 'image count exceeds budget');
    return Object.freeze({ status: 'allowed', maxUsd, maxImages });
  }
  if (request.capability === 'videos') {
    const maxVideoSeconds = positiveNumber(
      environment.DUODUO_AI_LIVE_MAX_VIDEO_SECONDS,
    );
    if (maxVideoSeconds === undefined)
      return skipped(
        'VIDEO_BUDGET_REQUIRED',
        'DUODUO_AI_LIVE_MAX_VIDEO_SECONDS is required for video tests',
      );
    if ((request.requestedVideoSeconds ?? 0) > maxVideoSeconds)
      return skipped('VIDEO_BUDGET_EXCEEDED', 'video seconds exceed budget');
    return Object.freeze({ status: 'allowed', maxUsd, maxVideoSeconds });
  }
  return Object.freeze({ status: 'allowed', maxUsd });
}

function skipped(code: string, reason: string): LiveRunDecision {
  return Object.freeze({ status: 'skipped', code, reason });
}

function positiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = positiveNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
}
