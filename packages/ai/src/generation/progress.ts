export type GenerationDomain = 'images' | 'videos';
export type GenerationPhase = 'queued' | 'preparing' | 'running' | 'finalizing';

export interface GenerationProgress {
  readonly phase?: GenerationPhase;
  readonly progress?: number;
  readonly queuePosition?: number;
  readonly estimatedWaitMs?: number;
}

export function validateGenerationProgress(
  input: GenerationProgress,
): Readonly<GenerationProgress> {
  if (
    input.phase !== undefined &&
    !['queued', 'preparing', 'running', 'finalizing'].includes(input.phase)
  )
    throw new TypeError('invalid generation phase');
  if (
    input.progress !== undefined &&
    (!Number.isFinite(input.progress) ||
      input.progress < 0 ||
      input.progress > 1)
  )
    throw new TypeError('generation progress must be between 0 and 1');
  for (const [name, value] of [
    ['queuePosition', input.queuePosition],
    ['estimatedWaitMs', input.estimatedWaitMs],
  ] as const)
    if (value !== undefined && (!Number.isInteger(value) || value < 0))
      throw new TypeError(`${name} must be a non-negative integer`);
  return Object.freeze({ ...input });
}
