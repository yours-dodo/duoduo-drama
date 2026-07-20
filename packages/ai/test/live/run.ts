import { pathToFileURL } from 'node:url';

import {
  CLI_SKIPPED_EXIT_CODE,
  CLI_UNAVAILABLE_EXIT_CODE,
  CLI_USAGE_EXIT_CODE,
  evaluateLiveRun,
  redactCliValue,
  type LiveCapability,
  type LiveRunDecision,
} from '@duoduo/ai/cli';

export interface LiveHarnessRequest {
  readonly provider: string;
  readonly model: string;
  readonly capability: LiveCapability;
  readonly estimatedMaxUsd: number;
  readonly requestedImages?: number;
  readonly requestedVideoSeconds?: number;
}

export interface LiveHarnessExecutor {
  execute(
    request: LiveHarnessRequest,
  ): Promise<Readonly<Record<string, unknown>>>;
}

export interface RunLiveHarnessOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly stdout?: Pick<NodeJS.WriteStream, 'write'>;
  readonly stderr?: Pick<NodeJS.WriteStream, 'write'>;
  readonly executor?: LiveHarnessExecutor;
}

export async function runLiveHarness(
  args: readonly string[],
  options: RunLiveHarnessOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const parsed = parseArgs(args);
  if (parsed.status === 'invalid') {
    stderr.write(`${parsed.reason}\n${usage()}\n`);
    return CLI_USAGE_EXIT_CODE;
  }

  const decision = evaluateLiveRun(
    {
      provider: parsed.request.provider,
      model: parsed.request.model,
      capability: parsed.request.capability,
      allowPaid: parsed.allowPaid,
      estimatedMaxUsd: parsed.request.estimatedMaxUsd,
      ...(parsed.request.requestedImages === undefined
        ? {}
        : { requestedImages: parsed.request.requestedImages }),
      ...(parsed.request.requestedVideoSeconds === undefined
        ? {}
        : { requestedVideoSeconds: parsed.request.requestedVideoSeconds }),
    },
    options.environment ?? process.env,
  );
  if (decision.status === 'skipped') {
    stdout.write(`${JSON.stringify(redactCliValue(decision))}\n`);
    return CLI_SKIPPED_EXIT_CODE;
  }

  if (!options.executor) {
    const unavailable = {
      status: 'unavailable',
      code: 'LIVE_EXECUTOR_NOT_CONFIGURED',
      reason:
        'Safety gates passed, but this repository does not install a network executor. Inject an audited provider-specific executor.',
      request: parsed.request,
      budget: decision,
    };
    stdout.write(`${JSON.stringify(redactCliValue(unavailable))}\n`);
    return CLI_UNAVAILABLE_EXIT_CODE;
  }

  const result = await options.executor.execute(parsed.request);
  stdout.write(
    `${JSON.stringify(redactCliValue({ status: 'completed', request: parsed.request, budget: decision, result }))}\n`,
  );
  return 0;
}

type ParsedArgs =
  | Readonly<{
      status: 'valid';
      allowPaid: boolean;
      request: LiveHarnessRequest;
    }>
  | Readonly<{ status: 'invalid'; reason: string }>;

function parseArgs(args: readonly string[]): ParsedArgs {
  const values = new Map<string, string>();
  let allowPaid = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--') continue;
    if (argument === '--allow-paid') {
      allowPaid = true;
      continue;
    }
    if (!argument.startsWith('--'))
      return invalid(`unexpected positional argument: ${argument}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--'))
      return invalid(`missing value for ${argument}`);
    values.set(argument, value);
    index += 1;
  }

  const provider = values.get('--provider');
  const model = values.get('--model');
  if (!provider) return invalid('--provider is required');
  if (!model) return invalid('--model is required');
  const capability = values.get('--capability') ?? 'chat';
  if (!isLiveCapability(capability))
    return invalid('--capability must be chat, images, or videos');
  const estimatedMaxUsd = finiteNonNegative(
    values.get('--estimated-max-usd') ?? '0',
  );
  if (estimatedMaxUsd === undefined)
    return invalid('--estimated-max-usd must be a finite non-negative number');
  const requestedImages = optionalPositiveInteger(values.get('--images'));
  if (values.has('--images') && requestedImages === undefined)
    return invalid('--images must be a positive integer');
  const requestedVideoSeconds = optionalPositiveNumber(
    values.get('--video-seconds'),
  );
  if (values.has('--video-seconds') && requestedVideoSeconds === undefined)
    return invalid('--video-seconds must be a positive number');
  if (capability === 'images' && requestedVideoSeconds !== undefined)
    return invalid('--video-seconds is only valid for videos');
  if (capability === 'videos' && requestedImages !== undefined)
    return invalid('--images is only valid for images');

  return Object.freeze({
    status: 'valid' as const,
    allowPaid,
    request: Object.freeze({
      provider,
      model,
      capability,
      estimatedMaxUsd,
      ...(requestedImages === undefined ? {} : { requestedImages }),
      ...(requestedVideoSeconds === undefined ? {} : { requestedVideoSeconds }),
    }),
  });
}

function usage(): string {
  return [
    'Usage: test:live -- --provider <kind> --model <id> --allow-paid',
    '  [--capability chat|images|videos] [--estimated-max-usd <usd>]',
    '  [--images <count>] [--video-seconds <seconds>]',
  ].join('\n');
}

function invalid(reason: string): ParsedArgs {
  return Object.freeze({ status: 'invalid', reason });
}

function isLiveCapability(value: string): value is LiveCapability {
  return value === 'chat' || value === 'images' || value === 'videos';
}

function finiteNonNegative(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function optionalPositiveInteger(
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function optionalPositiveNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  process.exitCode = await runLiveHarness(process.argv.slice(2));
}

void (undefined as unknown as LiveRunDecision);
