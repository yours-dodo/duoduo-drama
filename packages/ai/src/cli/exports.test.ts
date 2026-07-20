import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = resolve(packageRoot, 'src');
const packageManifest = JSON.parse(
  readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
) as {
  exports: Readonly<Record<string, { import: string; types: string }>>;
  scripts: Readonly<Record<string, string>>;
  dependencies?: Readonly<Record<string, string>>;
  devDependencies?: Readonly<Record<string, string>>;
};

describe('exports and consumer import boundaries', () => {
  it('keeps the root entry provider-neutral and free of CLI, OAuth, and Node stores', () => {
    const graph = collectStaticGraph(resolve(sourceRoot, 'index.ts'));
    expect(graph).not.toContain('providers/all/index.ts');
    expect(graph.some((path) => path.startsWith('cli/'))).toBe(false);
    expect(graph.some((path) => path.startsWith('auth/oauth/'))).toBe(false);
    expect(graph.some((path) => path.startsWith('auth/node/'))).toBe(false);
  });

  it('keeps a single Provider import isolated from other Providers and Node-only services', () => {
    const graph = collectStaticGraph(
      resolve(sourceRoot, 'providers/openai/index.ts'),
    );
    const foreignProviders = graph.filter(
      (path) =>
        path.startsWith('providers/') && !path.startsWith('providers/openai/'),
    );
    expect(foreignProviders).toEqual([]);
    expect(graph.some((path) => path.startsWith('auth/oauth/'))).toBe(false);
    expect(graph.some((path) => path.startsWith('auth/node/'))).toBe(false);
    expect(graph.some((path) => path.startsWith('cli/'))).toBe(false);

    const dependencyNames = Object.keys({
      ...(packageManifest.dependencies ?? {}),
      ...(packageManifest.devDependencies ?? {}),
    });
    expect(
      dependencyNames.filter((name) =>
        /^(?:@aws-sdk\/|@google-cloud\/|openai$|anthropic$)/u.test(name),
      ),
    ).toEqual([]);
  });

  it('loads every built-in Provider only from the explicit providers/all entry', () => {
    const allGraph = collectStaticGraph(
      resolve(sourceRoot, 'providers/all/index.ts'),
    );
    const providerKinds = Object.keys(packageManifest.exports)
      .filter((subpath) => /^\.\/providers\/[^/]+$/u.test(subpath))
      .map((subpath) => subpath.slice('./providers/'.length))
      .filter((kind) => kind !== 'all')
      .sort();
    const importedKinds = allGraph
      .filter(
        (path) =>
          /^providers\/[^/]+\/index\.ts$/u.test(path) &&
          path !== 'providers/all/index.ts',
      )
      .map((path) => path.split('/')[1]!)
      .sort();
    expect(importedKinds).toEqual(providerKinds);
  });

  it('publishes the productization entrypoints and never wires live tests into normal commands', () => {
    expect(packageManifest.exports).toMatchObject({
      './providers': {
        import: './dist/providers/index.js',
        types: './dist/providers/index.d.ts',
      },
      './providers/all': {
        import: './dist/providers/all/index.js',
        types: './dist/providers/all/index.d.ts',
      },
      './cli': {
        import: './dist/cli/index.js',
        types: './dist/cli/index.d.ts',
      },
    });
    for (const script of ['test', 'build', 'catalog:update']) {
      expect(packageManifest.scripts[script]).not.toContain('test/live');
    }
  });
});

function collectStaticGraph(entry: string): readonly string[] {
  const visited = new Set<string>();
  const visit = (absolutePath: string): void => {
    const normalizedPath = resolve(absolutePath);
    if (visited.has(normalizedPath)) return;
    visited.add(normalizedPath);
    const source = readFileSync(normalizedPath, 'utf8');
    for (const specifier of staticRelativeImports(source)) {
      const importedPath = resolve(dirname(normalizedPath), specifier).replace(
        /\.js$/u,
        '.ts',
      );
      visit(importedPath);
    }
  };
  visit(entry);
  return Object.freeze(
    [...visited].map((path) =>
      relative(sourceRoot, path).replaceAll('\\', '/'),
    ),
  );
}

function staticRelativeImports(source: string): readonly string[] {
  const imports: string[] = [];
  const pattern = /(?:from\s+|import\s*)['"](\.{1,2}\/[^'"]+)['"]/gu;
  for (const match of source.matchAll(pattern)) imports.push(match[1]!);
  return imports;
}
