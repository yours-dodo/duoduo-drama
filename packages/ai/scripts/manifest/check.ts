import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  const sourcePath = target.import
    .replace(/^\.\/dist\//u, 'src/')
    .replace(/\.js$/u, '.ts');
  if (!existsSync(resolve(packageRoot, sourcePath)))
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
  { length: 21 },
  (_, index) => `S${String(index + 1).padStart(2, '0')}`,
)) {
  if (!new RegExp(`^\\| ${id} .+\\| passed\\s+\\|`, 'mu').test(status))
    failures.push(`${id} is not marked passed in IMPLEMENTATION-STATUS.md`);
}

if (failures.length > 0) {
  process.stderr.write(`Manifest check failed:\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Manifest verified: ${catalogKinds.length} providers, ${Object.keys(packageExports).length} public exports, S01-S21 passed.\n`,
  );
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
