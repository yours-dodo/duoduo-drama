import { access, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createNodeEnvironmentSource } from '../auth/node/index.js';
import { secret } from '../auth/secret-value.js';
import {
  createAeadCredentialCodec,
  createNodeCliDependencies,
  resolveNodeCliPaths,
} from './node.js';
import { CLI_EXIT_CREDENTIAL_KEY_UNAVAILABLE, runCli } from './runner.js';

describe('Node CLI assembly', () => {
  it('resolves platform state paths and honors DUODUO_AI_HOME', () => {
    const override = resolveNodeCliPaths(
      createNodeEnvironmentSource({ DUODUO_AI_HOME: '/tmp/duoduo-explicit' }),
      'linux',
      '/home/example',
    );
    expect(override).toEqual({
      stateDirectory: '/tmp/duoduo-explicit',
      configFile: '/tmp/duoduo-explicit/config.json',
      credentialDirectory: '/tmp/duoduo-explicit/credentials',
      catalogDirectory: '/tmp/duoduo-explicit/catalogs',
    });
    expect(
      resolveNodeCliPaths(
        createNodeEnvironmentSource({ XDG_STATE_HOME: '/state' }),
        'linux',
        '/home/example',
      ).stateDirectory,
    ).toBe('/state/duoduo-ai');
    expect(
      resolveNodeCliPaths(undefined, 'darwin', '/Users/example').stateDirectory,
    ).toBe('/Users/example/Library/Application Support/duoduo-ai');
    expect(
      resolveNodeCliPaths(
        createNodeEnvironmentSource({
          LOCALAPPDATA: 'C:\\Users\\e\\AppData\\Local',
        }),
        'win32',
        'C:\\Users\\e',
      ).stateDirectory,
    ).toBe('C:\\Users\\e\\AppData\\Local/duoduo-ai');
  });

  it('does not create a plaintext credential store when no non-interactive key exists', async () => {
    const home = await mkdtemp(join(tmpdir(), 'duoduo-cli-no-key-'));
    let stdout = '';
    let stderr = '';
    const dependencies = await createNodeCliDependencies({
      environment: createNodeEnvironmentSource({ DUODUO_AI_HOME: home }),
      stdout: { write: (text) => void (stdout += text) },
      stderr: { write: (text) => void (stderr += text) },
    });
    try {
      expect(
        await runCli(
          ['auth', 'login', 'openai', '--method', 'api_key', '--json'],
          dependencies,
        ),
      ).toBe(CLI_EXIT_CREDENTIAL_KEY_UNAVAILABLE);
      expect(stdout).toBe('');
      expect(stderr).toContain('CREDENTIAL_CODEC_KEY_UNAVAILABLE');
      await expect(access(join(home, 'credentials'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await dependencies.runtime.dispose();
    }
  });

  it('loads non-secret provider options and the default account from config.json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'duoduo-cli-config-'));
    await writeFile(
      join(home, 'config.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        defaultAccount: 'team-a',
        providers: { qwen: { region: 'cn-beijing' } },
      })}\n`,
      { mode: 0o600 },
    );
    let stdout = '';
    let stderr = '';
    const dependencies = await createNodeCliDependencies({
      environment: createNodeEnvironmentSource({
        DUODUO_AI_HOME: home,
        DUODUO_AI_MASTER_KEY: Buffer.alloc(32, 11).toString('base64url'),
      }),
      stdout: { write: (text) => void (stdout += text) },
      stderr: { write: (text) => void (stderr += text) },
    });
    try {
      expect(
        dependencies.unconfigured.some((entry) => entry.kind === 'qwen'),
      ).toBe(false);
      expect(
        dependencies.runtime.providers
          .list()
          .some((provider) => provider.id === 'qwen'),
      ).toBe(true);
      expect(
        await runCli(['auth', 'status', 'qwen', '--json'], dependencies),
      ).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toContain('unconfigured');
    } finally {
      await dependencies.runtime.dispose();
    }
  });

  it('rejects secret-shaped or symlinked config files', async () => {
    const secretHome = await mkdtemp(join(tmpdir(), 'duoduo-cli-secret-'));
    await writeFile(
      join(secretHome, 'config.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        providers: { openai: { apiKey: 'must-not-live-here' } },
      })}\n`,
      { mode: 0o600 },
    );
    await expect(
      createNodeCliDependencies({
        environment: createNodeEnvironmentSource({
          DUODUO_AI_HOME: secretHome,
        }),
      }),
    ).rejects.toThrow(/secret|credential/i);

    const symlinkHome = await mkdtemp(join(tmpdir(), 'duoduo-cli-link-'));
    const target = join(symlinkHome, 'actual-config.json');
    await writeFile(
      target,
      `${JSON.stringify({ schemaVersion: 1, providers: {} })}\n`,
      { mode: 0o600 },
    );
    await symlink(target, join(symlinkHome, 'config.json'));
    await expect(
      createNodeCliDependencies({
        environment: createNodeEnvironmentSource({
          DUODUO_AI_HOME: symlinkHome,
        }),
      }),
    ).rejects.toThrow(/symbolic link/i);
  });

  it('creates the design-specified AES-256-GCM codec from an options object', async () => {
    const key = secret(Buffer.alloc(32, 7).toString('base64url'));
    const codec = createAeadCredentialCodec({
      algorithm: 'AES-256-GCM',
      keySource: {
        identityLifetime: 'cross-runtime',
        active: async () => ({ status: 'available', keyId: 'test-key', key }),
        byId: async () => ({ status: 'available', key }),
      },
    });

    const sealed = await codec.seal(Buffer.from('credential'), 'test-aad');
    expect(sealed.status).toBe('sealed');
  });
});
