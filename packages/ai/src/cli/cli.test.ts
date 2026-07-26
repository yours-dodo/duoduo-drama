import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { secret } from '../auth/secret-value.js';
import { createLocalScopeAuthority } from '../auth/node/local-scope.js';
import { createMemoryCredentialStore } from '../testing/memory-stores.js';
import { createAi } from '../runtime/create-ai.js';
import { createOpenAiProvider } from '../providers/openai/index.js';
import { builtinProviderKinds } from '../providers/all/index.js';
import {
  CLI_UNAVAILABLE_EXIT_CODE,
  redactCliValue,
  runCli,
  type CliWriter,
  type NodeCliDependencies,
} from './runner.js';
import {
  collectProviderInventory,
  createNodeCliDependencies,
  resolveNodeCliPaths,
} from './node.js';
import { createFileCatalogStore } from './file-catalog-store.js';

function capture(): { writer: CliWriter; text: () => string } {
  let value = '';
  return {
    writer: { write: (text) => void (value += text) },
    text: () => value,
  };
}

describe('cli inventory and auth', () => {
  it('lists all 38 builtin kinds without GitHub Copilot and marks missing non-secret config', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'duoduo-ai-cli-'));
    const stdout = capture();
    const stderr = capture();
    const dependencies = await createNodeCliDependencies({
      paths: { stateDirectory: directory },
      environment: { get: () => undefined },
      interaction: { promptSecret: async () => secret('unused') },
      stdout: stdout.writer,
      stderr: stderr.writer,
    });
    try {
      expect(builtinProviderKinds).toHaveLength(38);
      expect(builtinProviderKinds).not.toContain('github-copilot');
      expect(await runCli(['providers', '--json'], dependencies)).toBe(0);
      const output = JSON.parse(stdout.text()) as {
        providers: Array<{
          kind: string;
          status: string;
          missingOptions?: string[];
        }>;
      };
      expect(output.providers).toHaveLength(38);
      expect(output.providers).not.toContainEqual(
        expect.objectContaining({ kind: 'github-copilot' }),
      );
      expect(output.providers).toContainEqual({
        kind: 'qwen',
        status: 'unconfigured',
        missingOptions: ['region'],
      });
      expect(output.providers).toContainEqual({
        kind: 'self-hosted-generation',
        status: 'unconfigured',
        missingOptions: ['gateway', 'gatewayBaseUrl'],
      });
      expect(stderr.text()).toBe('');
    } finally {
      await dependencies.runtime.dispose();
    }
  });

  it('separates offline inventory from scope-aware configured models', async () => {
    const runtime = createAi();
    const provider = createOpenAiProvider();
    runtime.providers.register(provider);
    const stdout = capture();
    const stderr = capture();
    const dependencies: NodeCliDependencies<object> = {
      runtime,
      scope: {},
      interaction: { promptSecret: async () => secret('unused') },
      stdout: stdout.writer,
      stderr: stderr.writer,
      inventory: collectProviderInventory([provider]),
      unconfigured: [],
      credentialKeyAvailable: false,
    };
    expect(await runCli(['models', 'openai', '--json'], dependencies)).toBe(0);
    expect(JSON.parse(stdout.text())).toMatchObject({
      mode: 'inventory',
      models: [{ availability: 'unknown', capability: 'chat' }],
    });
    expect(
      await runCli(
        ['models', 'openai', '--configured', '--json'],
        dependencies,
      ),
    ).toBe(CLI_UNAVAILABLE_EXIT_CODE);
    expect(stderr.text()).toContain('CREDENTIAL_CODEC_KEY_UNAVAILABLE');
    await runtime.dispose();
  });

  it('logs in and out through the runtime auth API', async () => {
    const local = createLocalScopeAuthority({
      tenantId: 'local',
      subjectId: 'local-cli',
    });
    const runtime = createAi({
      credentialStore: createMemoryCredentialStore(),
      scopeAuthority: local.authority,
    });
    const provider = createOpenAiProvider();
    runtime.providers.register(provider);
    const stdout = capture();
    const dependencies: NodeCliDependencies<typeof local.scope> = {
      runtime,
      scope: local.scope,
      interaction: { promptSecret: async () => secret('sk-test-value') },
      stdout: stdout.writer,
      stderr: capture().writer,
      inventory: collectProviderInventory([provider]),
      unconfigured: [],
      credentialKeyAvailable: true,
    };
    expect(
      await runCli(
        ['auth', 'login', 'openai', '--method', 'api_key', '--json'],
        dependencies,
      ),
    ).toBe(0);
    expect(stdout.text()).toContain('"status":"ready"');
    expect(await runtime.auth.status('openai', local.scope)).toMatchObject({
      status: 'ready',
      source: 'stored',
    });
    expect(
      await runCli(['auth', 'logout', 'openai', '--json'], dependencies),
    ).toBe(0);
    expect(await runtime.auth.status('openai', local.scope)).toEqual({
      status: 'unconfigured',
    });
    await runtime.dispose();
  });

  it('redacts secret-shaped fields and strings', () => {
    expect(
      redactCliValue({
        apiKey: 'sk-should-not-appear',
        message: 'Bearer abc.def and https://example.test/?token=secret-value',
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      }),
    ).toEqual({
      apiKey: '[REDACTED]',
      message: 'Bearer [REDACTED] and https://example.test/?token=[REDACTED]',
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
  });
});

describe('cli node persistence', () => {
  it('resolves a DUODUO_AI_HOME override', () => {
    expect(
      resolveNodeCliPaths({
        get: (name) =>
          name === 'DUODUO_AI_HOME' ? '/tmp/custom-ai' : undefined,
      }),
    ).toEqual({
      stateDirectory: '/tmp/custom-ai',
      configFile: '/tmp/custom-ai/config.json',
      credentialDirectory: '/tmp/custom-ai/credentials',
      catalogDirectory: '/tmp/custom-ai/catalogs',
    });
  });

  it('persists public catalogs atomically with restrictive permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'duoduo-ai-catalog-'));
    const store = createFileCatalogStore({
      directory,
      clock: { now: () => 100 },
    });
    const key = {
      capability: 'chat',
      providerInstanceId: 'openai',
      providerCatalogBindingFingerprint: 'binding',
      providerConfigFingerprint: 'config',
      authBindingFingerprint: 'auth',
      credentialScopeFingerprint: 'scope',
      credentialInstanceId: 'credential',
      catalogVisibilityFingerprint: 'visible',
      schemaVersion: 1,
    };
    const ticket = await store.beginRefresh(key);
    const result = await store.commitRefresh(key, ticket, {
      payload: { models: ['gpt-test'] },
      ttlMs: 1_000,
      digest: 'a'.repeat(64),
    });
    expect(result.status).toBe('written');
    expect(await store.read(key)).toMatchObject({ expiresAt: 1_100 });
    const files = await import('node:fs/promises').then(({ readdir }) =>
      readdir(directory),
    );
    const recordFile = files.find((file) => file.endsWith('.json'))!;
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, recordFile))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(directory, recordFile), 'utf8')).not.toContain(
      'credentialScopeFingerprint',
    );
  });
});
