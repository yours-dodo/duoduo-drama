import { access, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
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
  it('resolves project-local state paths from a nested workspace directory', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'duoduo-cli-workspace-'));
    const projectDirectory = join(workspace, 'apps', 'agent', 'src');
    await mkdir(projectDirectory, { recursive: true });
    await writeFile(join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n');

    expect(
      resolveNodeCliPaths(createNodeEnvironmentSource({}), projectDirectory),
    ).toEqual({
      stateDirectory: join(workspace, '.duoduo-drama'),
      configFile: join(workspace, '.duoduo-drama', 'config.json'),
      credentialDirectory: join(workspace, '.duoduo-drama', 'credentials'),
      catalogDirectory: join(workspace, '.duoduo-drama', 'catalogs'),
    });
  });

  it('prefers a pnpm workspace marker over a nested git marker', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'duoduo-cli-markers-'));
    const nestedRepository = join(workspace, 'vendor', 'nested');
    const projectDirectory = join(nestedRepository, 'src');
    await mkdir(projectDirectory, { recursive: true });
    await mkdir(join(nestedRepository, '.git'));
    await writeFile(join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n');

    expect(
      resolveNodeCliPaths(createNodeEnvironmentSource({}), projectDirectory)
        .stateDirectory,
    ).toBe(join(workspace, '.duoduo-drama'));
  });

  it('falls back to a git root and then to the discovery start directory', async () => {
    const gitRoot = await mkdtemp(join(tmpdir(), 'duoduo-cli-git-'));
    const gitProject = join(gitRoot, 'packages', 'ai');
    await mkdir(gitProject, { recursive: true });
    await writeFile(join(gitRoot, '.git'), 'gitdir: elsewhere\n');
    expect(
      resolveNodeCliPaths(createNodeEnvironmentSource({}), gitProject)
        .stateDirectory,
    ).toBe(join(gitRoot, '.duoduo-drama'));

    const standalone = await mkdtemp(join(tmpdir(), 'duoduo-cli-standalone-'));
    expect(
      resolveNodeCliPaths(createNodeEnvironmentSource({}), standalone)
        .stateDirectory,
    ).toBe(join(standalone, '.duoduo-drama'));
  });

  it('honors DUODUO_AI_HOME before project discovery', () => {
    const override = resolveNodeCliPaths(
      createNodeEnvironmentSource({ DUODUO_AI_HOME: '/tmp/duoduo-explicit' }),
      '/path/that/does/not/exist',
    );
    expect(override).toEqual({
      stateDirectory: '/tmp/duoduo-explicit',
      configFile: '/tmp/duoduo-explicit/config.json',
      credentialDirectory: '/tmp/duoduo-explicit/credentials',
      catalogDirectory: '/tmp/duoduo-explicit/catalogs',
    });
  });

  it('rejects a DUODUO_AI_HOME override that is not a directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'duoduo-cli-home-file-'));
    const file = join(directory, 'state-file');
    await writeFile(file, 'not a directory');

    expect(() =>
      resolveNodeCliPaths(
        createNodeEnvironmentSource({ DUODUO_AI_HOME: file }),
        '/path/that/does/not/exist',
      ),
    ).toThrow(/DUODUO_AI_HOME.*directory/i);
  });

  it('rejects a missing or non-directory project discovery start', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'duoduo-cli-invalid-'));
    const file = join(directory, 'file.txt');
    await writeFile(file, 'not a directory');

    expect(() =>
      resolveNodeCliPaths(
        createNodeEnvironmentSource({}),
        join(directory, 'missing'),
      ),
    ).toThrow(/project directory/i);
    expect(() =>
      resolveNodeCliPaths(createNodeEnvironmentSource({}), file),
    ).toThrow(/project directory/i);
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

  it('keeps the project-local state and catalog directories lazy', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'duoduo-cli-lazy-'));
    const projectDirectory = join(workspace, 'packages', 'ai');
    await mkdir(projectDirectory, { recursive: true });
    await writeFile(join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n');

    const dependencies = await createNodeCliDependencies({
      projectDirectory,
      environment: createNodeEnvironmentSource({}),
    });
    try {
      await expect(
        access(join(workspace, '.duoduo-drama')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        access(join(workspace, '.duoduo-drama', 'catalogs')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
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
