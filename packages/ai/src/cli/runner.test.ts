import { describe, expect, it, vi } from 'vitest';

import type { AiRuntime, AuthInteraction } from '../index.js';
import type { LocalScopeHandle } from '../auth/node/index.js';
import {
  CLI_EXIT_CREDENTIAL_KEY_UNAVAILABLE,
  CLI_USAGE_EXIT_CODE,
  runCli,
  type CliWriter,
  type NodeCliDependencies,
} from './runner.js';

function capture(): { writer: CliWriter; text(): string } {
  let value = '';
  return {
    writer: { write: (text) => void (value += text) },
    text: () => value,
  };
}

function dependencies(
  overrides: Partial<NodeCliDependencies<LocalScopeHandle>> = {},
) {
  const stdout = capture();
  const stderr = capture();
  const status = vi.fn(async () => ({ status: 'unconfigured' as const }));
  const login = vi.fn(async () => ({ status: 'unconfigured' as const }));
  const runtime = {
    providers: { list: () => [] },
    models: { list: vi.fn(async () => ({ models: [] })) },
    images: { models: { list: vi.fn(async () => ({ models: [] })) } },
    videos: { models: { list: vi.fn(async () => ({ models: [] })) } },
    auth: {
      status,
      login,
      logout: vi.fn(async () => ({
        local: 'removed' as const,
        remote: 'not_requested' as const,
      })),
    },
  } as unknown as AiRuntime<LocalScopeHandle>;
  const deps: NodeCliDependencies<LocalScopeHandle> = {
    runtime,
    scope: { tenantId: 'local', subjectId: 'local-cli' },
    interaction: {} as AuthInteraction,
    stdout: stdout.writer,
    stderr: stderr.writer,
    inventory: [],
    unconfigured: [],
    credentialKeyAvailable: true,
    ...overrides,
  };
  return { deps, stdout, stderr, status, login };
}

describe('duoduo-ai CLI account selection', () => {
  it('uses the configured default account unless --account overrides it', async () => {
    const configured = dependencies({ defaultAccount: 'team-a' });
    expect(
      await runCli(['auth', 'status', 'openai', '--json'], configured.deps),
    ).toBe(0);
    expect(configured.status).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({ credentialSlotId: 'team-a' }),
    );

    const overridden = dependencies({ defaultAccount: 'team-a' });
    expect(
      await runCli(
        ['auth', 'status', 'openai', '--account', 'team-b', '--json'],
        overridden.deps,
      ),
    ).toBe(0);
    expect(overridden.status).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({ credentialSlotId: 'team-b' }),
    );
  });

  it('fails closed with a stable code when the credential key is unavailable', async () => {
    const fixture = dependencies({ credentialKeyAvailable: false });
    expect(
      await runCli(
        ['auth', 'login', 'openai', '--method', 'api_key', '--json'],
        fixture.deps,
      ),
    ).toBe(CLI_EXIT_CREDENTIAL_KEY_UNAVAILABLE);
    expect(fixture.login).not.toHaveBeenCalled();
    expect(fixture.stderr.text()).toContain('CREDENTIAL_CODEC_KEY_UNAVAILABLE');
  });
});

describe('duoduo-ai CLI model listing', () => {
  it('lists configured models without claiming remote availability', async () => {
    const fixture = dependencies();
    vi.mocked(fixture.deps.runtime.models.list).mockResolvedValue({
      models: [
        {
          definition: {
            providerInstanceId: 'openai',
            id: 'gpt-test',
            protocol: 'openai-responses',
          },
        } as never,
      ],
    });

    expect(
      await runCli(
        ['models', 'openai', '--configured', '--json'],
        fixture.deps,
      ),
    ).toBe(0);
    expect(JSON.parse(fixture.stdout.text())).toEqual({
      mode: 'configured',
      models: [
        {
          capability: 'chat',
          providerInstanceId: 'openai',
          modelId: 'gpt-test',
          protocol: 'openai-responses',
          configuration: 'configured',
          availability: 'unknown',
        },
      ],
    });
  });

  it.each([['refresh'], ['openai', '--available']])(
    'rejects the removed models syntax: %s',
    async (...args) => {
      const fixture = dependencies();

      expect(await runCli(['models', ...args, '--json'], fixture.deps)).toBe(
        CLI_USAGE_EXIT_CODE,
      );
      expect(fixture.stderr.text()).toContain('CLI_USAGE');
    },
  );
});
