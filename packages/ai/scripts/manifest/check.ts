import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DuoduoGenerationGateway } from '../../src/protocols/duoduo-generation-v1/contracts.js';
import type {
  BuiltinProvidersOptions,
  BuiltinProvidersResult,
} from '../../src/providers/all/index.js';
import type {
  Provider,
  ProviderProtocolManifest,
} from '../../src/runtime/registry.js';

interface ExportTarget {
  readonly types: string;
  readonly import: string;
}

interface PackageManifest {
  readonly exports?: Readonly<Record<string, ExportTarget>>;
  readonly bin?: Readonly<Record<string, string>>;
}

interface GeneratedCatalog {
  readonly providers: readonly Readonly<{ kind: string }>[];
}

interface BuiltinProvidersModule {
  builtinProviders(
    options?: BuiltinProvidersOptions,
  ): Promise<BuiltinProvidersResult>;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, '../..');
const packageManifest = readJson<PackageManifest>('package.json');
const catalog = readJson<GeneratedCatalog>(
  'src/providers/_generated/builtin-catalog.generated.json',
);
const packageExports = packageManifest.exports ?? {};
const failures: string[] = [];

const catalogKinds = catalog.providers.map(({ kind }) => kind);
const uniqueCatalogKinds = new Set(catalogKinds);
if (catalogKinds.length !== 40)
  failures.push(
    `generated catalog contains ${catalogKinds.length} providers; expected 40`,
  );
if (uniqueCatalogKinds.size !== catalogKinds.length)
  failures.push('generated catalog provider kinds must be unique');

const providerExportKinds = Object.keys(packageExports)
  .filter((subpath) => /^\.\/providers\/[^/]+$/u.test(subpath))
  .map((subpath) => subpath.slice('./providers/'.length))
  .filter((kind) => kind !== 'all')
  .sort();
const sortedCatalogKinds = [...catalogKinds].sort();
if (JSON.stringify(providerExportKinds) !== JSON.stringify(sortedCatalogKinds))
  failures.push(
    `provider exports and generated catalog differ:\nexports=${providerExportKinds.join(',')}\ncatalog=${sortedCatalogKinds.join(',')}`,
  );

for (const requiredSubpath of ['./providers', './providers/all', './cli']) {
  if (!(requiredSubpath in packageExports))
    failures.push(`package export ${requiredSubpath} is missing`);
}

for (const [subpath, target] of Object.entries(packageExports)) {
  if (!isExportTarget(target)) {
    failures.push(
      `package export ${subpath} must declare types and import targets`,
    );
    continue;
  }
  if (!target.import.startsWith('./dist/') || !target.import.endsWith('.js'))
    failures.push(
      `package export ${subpath} has invalid import target ${target.import}`,
    );
  if (!target.types.startsWith('./dist/') || !target.types.endsWith('.d.ts'))
    failures.push(
      `package export ${subpath} has invalid types target ${target.types}`,
    );
  if (target.types !== `${target.import.slice(0, -3)}.d.ts`)
    failures.push(`package export ${subpath} import/types targets disagree`);

  const sourcePath = resolve(
    packageRoot,
    target.import.replace(/^\.\/dist\//u, './src/').replace(/\.js$/u, '.ts'),
  );
  if (!existsSync(sourcePath))
    failures.push(`package export ${subpath} source is missing: ${sourcePath}`);

  const outputPath = resolve(packageRoot, target.import);
  if (existsSync(resolve(packageRoot, 'dist')) && !existsSync(outputPath))
    failures.push(
      `built package export ${subpath} is missing: ${target.import}`,
    );
}

if (packageManifest.bin?.['duoduo-ai'] !== './dist/cli/bin.js')
  failures.push('package bin duoduo-ai must point to ./dist/cli/bin.js');

const status = readFileSync(
  resolve(packageRoot, 'IMPLEMENTATION-STATUS.md'),
  'utf8',
);
for (const id of Array.from(
  { length: 22 },
  (_, index) => `S${String(index + 1).padStart(2, '0')}`,
)) {
  if (!new RegExp(`^\\| ${id} .+\\| passed\\s+\\|`, 'mu').test(status))
    failures.push(`${id} is not marked passed in IMPLEMENTATION-STATUS.md`);
}

const coverage = await verifyProviderCoverage();

if (failures.length > 0) {
  process.stderr.write(`Manifest check failed:\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Manifest verified: ${coverage.coveredProviders}/${coverage.totalProviders} providers, ${coverage.coveredBindings}/${coverage.totalBindings} bindings, 100% coverage, ${Object.keys(packageExports).length} public exports, S01-S22 passed.\n`,
  );
}

async function verifyProviderCoverage(): Promise<{
  readonly coveredProviders: number;
  readonly totalProviders: number;
  readonly coveredBindings: number;
  readonly totalBindings: number;
}> {
  const allRuntimePath = resolve(
    packageRoot,
    packageExports['./providers/all']?.import ??
      './dist/providers/all/index.js',
  );
  if (!existsSync(allRuntimePath)) {
    failures.push(
      'built providers/all output is missing; run package build first',
    );
    return {
      coveredProviders: 0,
      totalProviders: catalogKinds.length,
      coveredBindings: 0,
      totalBindings: 0,
    };
  }

  const runtime = (await import(
    pathToFileURL(allRuntimePath).href
  )) as BuiltinProvidersModule;
  const gateway: DuoduoGenerationGateway = Object.freeze({
    adapterId: 'release-fixture',
    async listModels() {
      return Object.freeze({
        revision: '1',
        models: Object.freeze([
          Object.freeze({
            domain: 'images' as const,
            id: 'image',
            upstreamModelId: 'image',
            name: 'Image',
          }),
          Object.freeze({
            domain: 'videos' as const,
            id: 'video',
            upstreamModelId: 'video',
            name: 'Video',
          }),
        ]),
      });
    },
    async createTask() {
      throw new Error(
        'release manifest checker does not execute gateway tasks',
      );
    },
    async getTask() {
      throw new Error(
        'release manifest checker does not execute gateway tasks',
      );
    },
    async cancelTask() {
      throw new Error(
        'release manifest checker does not execute gateway tasks',
      );
    },
  });
  const options = {
    'azure-openai-responses': {
      baseUrl: 'https://fixture.openai.azure.com/openai',
      deploymentName: 'fixture',
    },
    'cloudflare-ai-gateway': {
      accountId: 'account',
      gatewayId: 'gateway',
    },
    'cloudflare-workers-ai': {
      accountId: 'account',
    },
    qwen: {
      region: 'cn-beijing',
    },
    'self-hosted-generation': {
      gateway,
      gatewayBaseUrl: 'https://generation.example/v1',
    },
  } satisfies BuiltinProvidersOptions;
  const result = await runtime.builtinProviders(options);

  if (result.unconfigured.length > 0)
    failures.push(
      `configured provider inventory still reports unconfigured kinds: ${result.unconfigured
        .map(
          ({ kind, missingOptions }) => `${kind}(${missingOptions.join(',')})`,
        )
        .join(', ')}`,
    );
  if (result.providers.length !== catalogKinds.length)
    failures.push(
      `configured provider inventory contains ${result.providers.length} providers; expected ${catalogKinds.length}`,
    );

  let coveredProviders = 0;
  let totalBindings = 0;
  let coveredBindings = 0;
  const runtimeKinds = new Set<string>();
  for (const provider of result.providers) {
    runtimeKinds.add(provider.kind);
    const providerCoverage = verifyProvider(provider);
    totalBindings += providerCoverage.totalBindings;
    coveredBindings += providerCoverage.coveredBindings;
    if (providerCoverage.covered) coveredProviders += 1;
  }
  for (const kind of catalogKinds) {
    if (!runtimeKinds.has(kind))
      failures.push(`provider ${kind} was not constructed`);
  }
  return {
    coveredProviders,
    totalProviders: catalogKinds.length,
    coveredBindings,
    totalBindings,
  };
}

function verifyProvider(provider: Provider): {
  readonly covered: boolean;
  readonly coveredBindings: number;
  readonly totalBindings: number;
} {
  const actualBindings = actualBindingKeys(provider);
  const manifest = provider.contractManifest;
  if (!manifest) {
    failures.push(`provider ${provider.kind} has no contract manifest`);
    return {
      covered: false,
      coveredBindings: 0,
      totalBindings: actualBindings.size,
    };
  }
  let manifestValid = true;
  if (manifest.schemaVersion !== 1) {
    failures.push(`provider ${provider.kind} has unsupported manifest schema`);
    manifestValid = false;
  }
  if (manifest.providerKind !== provider.kind) {
    failures.push(
      `provider ${provider.kind} manifest kind is ${manifest.providerKind}`,
    );
    manifestValid = false;
  }
  if (manifest.bindings.length === 0) {
    failures.push(`provider ${provider.kind} manifest has no bindings`);
    manifestValid = false;
  }

  const declaredBindings = new Set<string>();
  let coveredBindings = 0;
  for (const binding of manifest.bindings) {
    const bindingValid = validateManifestBinding(provider.kind, binding);
    if (bindingValid) coveredBindings += 1;
    else manifestValid = false;
    declaredBindings.add(bindingKey(binding.capability, binding.protocol));
  }

  for (const key of actualBindings) {
    if (!declaredBindings.has(key)) {
      failures.push(`provider ${provider.kind} does not manifest ${key}`);
      manifestValid = false;
    }
  }

  return {
    covered:
      manifestValid &&
      coveredBindings === manifest.bindings.length &&
      actualBindings.size > 0,
    coveredBindings,
    totalBindings: manifest.bindings.length,
  };
}

function actualBindingKeys(provider: Provider): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const model of provider.chat?.models ?? [])
    keys.add(bindingKey('chat', model.protocol));
  for (const protocol of provider.images?.protocols ?? [])
    keys.add(bindingKey('images', protocol.protocol));
  for (const protocol of provider.videos?.protocols ?? [])
    keys.add(bindingKey('videos', protocol.protocol));
  return keys;
}

function validateManifestBinding(
  providerKind: string,
  binding: ProviderProtocolManifest,
): boolean {
  const failureCount = failures.length;
  const prefix = `provider ${providerKind} ${binding.capability}:${binding.protocol}`;
  if (binding.protocol.length === 0)
    failures.push(`${prefix} has empty protocol`);
  for (const [name, values] of [
    ['profileIds', binding.profileIds],
    ['authSchemes', binding.authSchemes],
    ['endpointBranchIds', binding.endpointBranchIds],
    ['requestFixtureIds', binding.requestFixtureIds],
    ['streamFixtureIds', binding.streamFixtureIds],
    ['errorFixtureIds', binding.errorFixtureIds],
  ] as const) {
    if (values.length === 0) failures.push(`${prefix} has empty ${name}`);
    if (new Set(values).size !== values.length)
      failures.push(`${prefix} has duplicate ${name}`);
    if (values.some((value) => value.trim().length === 0))
      failures.push(`${prefix} has blank ${name}`);
  }
  if (binding.sources.length === 0) failures.push(`${prefix} has no sources`);
  for (const source of binding.sources) {
    if (!['pi', 'official', 'fixture'].includes(source.kind))
      failures.push(`${prefix} has invalid source kind ${source.kind}`);
    if (source.locator.trim().length === 0)
      failures.push(`${prefix} has a blank source locator`);
    if (source.digest !== undefined && source.digest.trim().length === 0)
      failures.push(`${prefix} has a blank source digest`);
  }
  return failures.length === failureCount;
}

function bindingKey(capability: string, protocol: string): string {
  return `${capability}:${protocol}`;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(resolve(packageRoot, relativePath), 'utf8'),
  ) as T;
}

function isExportTarget(value: unknown): value is ExportTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ExportTarget>).types === 'string' &&
    typeof (value as Partial<ExportTarget>).import === 'string'
  );
}
