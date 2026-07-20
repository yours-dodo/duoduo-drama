import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, '../..');
const workspaceRoot = resolve(packageRoot, '../..');
const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'duoduo-ai-no-vendor-'));
const checkoutRoot = resolve(temporaryRoot, 'workspace');
const excludedNames = new Set([
  '.git',
  '.nuxt',
  '.output',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
]);
let failed = false;

try {
  cpSync(workspaceRoot, checkoutRoot, {
    recursive: true,
    verbatimSymlinks: true,
    filter(source) {
      if (source === workspaceRoot) return true;
      return !excludedNames.has(basename(source));
    },
  });
  if (existsSync(resolve(checkoutRoot, 'vendor')))
    throw new Error('temporary checkout unexpectedly contains vendor');

  const storePath = resolveStorePath();
  run('pnpm', [
    'install',
    '--offline',
    '--frozen-lockfile',
    '--store-dir',
    storePath,
  ]);
  run('pnpm', ['--filter', '@duoduo/ai', 'typecheck']);
  run('pnpm', ['--filter', '@duoduo/ai', 'test']);
  run('pnpm', ['--filter', '@duoduo/ai', 'build']);
  process.stdout.write(
    'No-vendor verified: offline reinstall completed without vendor/pi; @duoduo/ai typecheck, test, and build passed.\n',
  );
} catch (error) {
  failed = true;
  process.stderr.write(
    `No-vendor verification failed in ${temporaryRoot}: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  if (!failed || process.env.DUODUO_AI_KEEP_RELEASE_TEMP !== '1')
    rmSync(temporaryRoot, { recursive: true, force: true });
}

function resolveStorePath(): string {
  const modulesManifest = resolve(workspaceRoot, 'node_modules/.modules.yaml');
  if (existsSync(modulesManifest)) {
    const match = /^storeDir:\s*(.+)$/mu.exec(
      readFileSync(modulesManifest, 'utf8'),
    );
    if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/gu, '');
  }
  return commandOutput('pnpm', ['store', 'path', '--silent']);
}

function commandOutput(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} exited ${String(result.status)}`,
    );
  const output = result.stdout.trim();
  if (output.length === 0)
    throw new Error(`${command} ${args.join(' ')} returned no output`);
  return output;
}

function run(command: string, args: readonly string[]): void {
  process.stdout.write(`> ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd: checkoutRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} exited ${String(result.status)}`,
    );
}
