import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

type RedactCliValue = (value: unknown) => unknown;
type ToPublicAiError = (
  error: unknown,
  fallback: {
    code: string;
    category: 'internal';
    message: string;
  },
) => Error & { readonly details?: Readonly<Record<string, unknown>> };

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, '../..');
const failures: string[] = [];

verifyImportGraph();
verifyFixtureRedaction();
await verifySecretCanary();
verifyLiveDisabledByDefault();

if (failures.length > 0) {
  process.stderr.write(`Release check failed:\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    'Release verified: production import graph fenced, CLI and Runtime secret canaries redacted, fixtures sanitized, and live execution disabled by default.\n',
  );
}

function verifyImportGraph(): void {
  const productionFiles = walk(resolve(packageRoot, 'src')).filter(
    (path) =>
      extname(path) === '.ts' &&
      !path.endsWith('.test.ts') &&
      !path.endsWith('.d.ts'),
  );
  for (const path of productionFiles) {
    const source = readFileSync(path, 'utf8');
    const label = relative(packageRoot, path);
    if (/(?:from\s+|import\s*\()['"][^'"]*vendor\/pi/u.test(source))
      failures.push(`${label} imports vendor/pi`);
    if (/(?:from\s+|import\s*\()['"][^'"]*test\/live\/run/u.test(source))
      failures.push(`${label} imports the live harness`);
  }

  const rootEntry = readFileSync(resolve(packageRoot, 'src/index.ts'), 'utf8');
  for (const forbidden of [
    'providers/all',
    'providers/openai',
    'providers/anthropic',
    './testing',
    './cli',
    './auth/node',
  ]) {
    if (rootEntry.includes(forbidden))
      failures.push(`root entry imports forbidden boundary ${forbidden}`);
  }
}

function verifyFixtureRedaction(): void {
  const fixtureRoot = resolve(packageRoot, 'test/fixtures');
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /\bAKIA[0-9A-Z]{16}\b/u,
    /\bsk-[A-Za-z0-9_-]{20,}\b/u,
    /\bAIza[0-9A-Za-z_-]{30,}\b/u,
  ] as const;
  for (const path of walk(fixtureRoot)) {
    const source = readFileSync(path, 'utf8');
    const label = relative(packageRoot, path);
    for (const pattern of secretPatterns) {
      if (pattern.test(source))
        failures.push(`${label} contains a secret-shaped fixture value`);
    }
    for (const match of source.matchAll(
      /[?&](?:X-Amz-Signature|Signature)=([^&"\s]+)/giu,
    )) {
      const value = match[1]?.toLowerCase();
      if (value !== 'redacted' && value !== 'fixture' && value !== 'test')
        failures.push(`${label} contains an unredacted signed URL`);
    }
  }
}

async function verifySecretCanary(): Promise<void> {
  const cliRuntimePath = resolve(packageRoot, 'dist/cli/index.js');
  const runtime = (await import(pathToFileURL(cliRuntimePath).href)) as {
    redactCliValue?: RedactCliValue;
  };
  if (typeof runtime.redactCliValue !== 'function') {
    failures.push('CLI runtime does not export redactCliValue');
    return;
  }
  const canary = 's22-release-secret-canary-9f4f9b9e';
  const redacted = JSON.stringify(
    runtime.redactCliValue({
      apiKey: canary,
      access_token: canary,
      nested: { authorization: `Bearer ${canary}` },
      message: `request failed with Bearer ${canary}`,
    }),
  );
  if (redacted.includes(canary))
    failures.push('CLI redaction leaked the release secret canary');

  const publicErrorsPath = resolve(packageRoot, 'dist/core/public-errors.js');
  const publicErrors = (await import(pathToFileURL(publicErrorsPath).href)) as {
    toPublicAiError?: ToPublicAiError;
  };
  if (typeof publicErrors.toPublicAiError !== 'function') {
    failures.push('Runtime does not build the public error normalizer');
    return;
  }
  for (const media of ['image', 'video'] as const) {
    const fallback = {
      code: `${media.toUpperCase()}_GENERATION_INTERNAL_ERROR`,
      category: 'internal' as const,
      message: `${media} generation failed internally`,
    };
    const candidates = [
      new Error(canary),
      {
        name: 'AiError',
        code: `${media.toUpperCase()}_UPSTREAM_FAILED`,
        category: 'provider',
        retryable: false,
        message: canary,
        details: { raw: canary },
      },
    ];
    for (const candidate of candidates) {
      const publicError = publicErrors.toPublicAiError(candidate, fallback);
      if (
        publicError.message.includes(canary) ||
        (JSON.stringify(publicError.details) ?? '').includes(canary)
      )
        failures.push(`${media} Runtime leaked the release secret canary`);
    }
  }
}

function verifyLiveDisabledByDefault(): void {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('DUODUO_AI_LIVE')) delete environment[key];
  }
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      'test/live/run.ts',
      '--provider',
      'release-fixture',
      '--model',
      'release-fixture',
      '--estimated-max-usd',
      '0.01',
      '--allow-paid',
    ],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      env: environment,
    },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 3)
    failures.push(
      `live harness default exit code is ${String(result.status)}; expected 3`,
    );
  if (!output.includes('LIVE_DISABLED'))
    failures.push('live harness default output does not report LIVE_DISABLED');
}

function walk(root: string): readonly string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry);
    if (statSync(path).isDirectory()) paths.push(...walk(path));
    else paths.push(path);
  }
  return paths;
}
