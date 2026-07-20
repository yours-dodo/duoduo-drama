import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format } from 'prettier';

import { createBuiltinCatalog } from './generator.ts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, '../..');
const packageJson = JSON.parse(
  readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
) as { exports?: Record<string, unknown> };
const providerKinds = Object.keys(packageJson.exports ?? {})
  .filter((key) => /^\.\/providers\/[^/]+$/u.test(key))
  .map((key) => key.slice('./providers/'.length))
  .filter((kind) => kind !== 'all')
  .sort();

const requiredNonSecretOptions = Object.freeze({
  'azure-openai-responses': Object.freeze([
    'baseUrl|resourceName',
    'deploymentName|deploymentMap',
  ]),
  'cloudflare-ai-gateway': Object.freeze(['accountId', 'gatewayId']),
  'cloudflare-workers-ai': Object.freeze(['accountId']),
  qwen: Object.freeze(['region']),
  'self-hosted-generation': Object.freeze(['gateway', 'gatewayBaseUrl']),
});

const remoteDirectory = resolve(scriptDirectory, 'remote');
const remoteShards = existsSync(remoteDirectory)
  ? readdirSync(remoteDirectory)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) =>
        JSON.parse(readFileSync(resolve(remoteDirectory, name), 'utf8')),
      )
  : [];

if (!process.argv.includes('--offline') && process.argv.includes('--strict')) {
  // Strict mode intentionally consumes only pinned source files in this package.
  // Network fetchers must write reviewed safe shards before invoking this script.
}

const catalog = createBuiltinCatalog({
  providerKinds,
  requiredNonSecretOptions,
  remoteShards,
});
const output = await format(JSON.stringify(catalog), { parser: 'json' });
const outputPath = resolve(
  packageRoot,
  'src/providers/_generated/builtin-catalog.generated.json',
);

if (process.argv.includes('--check')) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output)
    throw new Error('builtin catalog is stale; run catalog:update');
  process.stdout.write(`Builtin catalog verified: ${catalog.digest}\n`);
} else {
  writeFileSync(outputPath, output);
  process.stdout.write(`Builtin catalog written: ${outputPath}\n`);
}
