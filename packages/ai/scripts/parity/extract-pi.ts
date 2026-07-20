import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_TEXT_PROTOCOLS = Object.freeze([
  'anthropic-messages',
  'azure-openai-responses',
  'bedrock-converse-stream',
  'google-generative-ai',
  'google-vertex',
  'mistral-conversations',
  'openai-chat-completions',
  'openai-codex-responses',
  'openai-responses',
  'pi-messages',
]);

const NON_PROVIDER_MODULES = new Set([
  'all',
  'cloudflare-auth',
  'cloudflare-stream',
  'faux',
  'openrouter-images',
  'radius-config',
]);

interface ParityLedger {
  readonly schemaVersion: 1;
  readonly providers: readonly string[];
  readonly textProtocols: readonly string[];
  readonly digest: string;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolvePiRoot(input: string): string {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(scriptDirectory, '../../../..');
  const candidates = [
    resolve(process.cwd(), input),
    resolve(repositoryRoot, input),
  ];
  const root = candidates.find((candidate) =>
    existsSync(resolve(candidate, 'packages/ai/src/providers')),
  );
  if (!root) {
    throw new Error(`PI root was not found: ${input}`);
  }
  return root;
}

function extractProviders(piRoot: string): readonly string[] {
  const directory = resolve(piRoot, 'packages/ai/src/providers');
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name.replace(/\.ts$/u, ''))
    .filter(
      (name) =>
        !name.endsWith('.models') &&
        !name.endsWith('.d') &&
        !NON_PROVIDER_MODULES.has(name),
    )
    .sort();
}

function extractTextProtocols(piRoot: string): readonly string[] {
  const directory = resolve(piRoot, 'packages/ai/src/api');
  const available = new Set(
    readdirSync(directory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.lazy.ts'),
      )
      .map((entry) => entry.name.replace(/\.ts$/u, '')),
  );
  const sourceNames = new Map<string, string>([
    ['openai-chat-completions', 'openai-completions'],
  ]);
  for (const protocol of EXPECTED_TEXT_PROTOCOLS) {
    const sourceName = sourceNames.get(protocol) ?? protocol;
    if (!available.has(sourceName)) {
      throw new Error(`PI text protocol source is missing: ${sourceName}`);
    }
  }
  return [...EXPECTED_TEXT_PROTOCOLS];
}

function createLedger(piRoot: string): ParityLedger {
  const providers = extractProviders(piRoot);
  const textProtocols = extractTextProtocols(piRoot);
  if (providers.length !== 36) {
    throw new Error(`Expected 36 PI providers, received ${providers.length}`);
  }
  if (textProtocols.length !== 10) {
    throw new Error(
      `Expected 10 PI text protocols, received ${textProtocols.length}`,
    );
  }
  const canonical = JSON.stringify({
    schemaVersion: 1,
    providers,
    textProtocols,
  });
  return Object.freeze({
    schemaVersion: 1,
    providers: Object.freeze(providers),
    textProtocols: Object.freeze(textProtocols),
    digest: createHash('sha256').update(canonical).digest('hex'),
  });
}

const piRoot = resolvePiRoot(argumentValue('--pi-root') ?? 'vendor/pi');
const ledger = createLedger(piRoot);
const output = `${JSON.stringify(ledger, undefined, 2)}\n`;
const outputPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/providers/_generated/pi-parity.generated.json',
);

if (process.argv.includes('--check')) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output) {
    throw new Error(
      'PI parity ledger is stale; run parity extractor without --check',
    );
  }
  process.stdout.write(`PI parity ledger verified: ${ledger.digest}\n`);
} else {
  writeFileSync(outputPath, output);
  process.stdout.write(`PI parity ledger written: ${outputPath}\n`);
}
