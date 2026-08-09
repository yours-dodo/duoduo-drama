import { describe, expect, it } from 'vitest';

import * as agentCore from './index.js';
import * as postgres from './postgres.js';

describe('@duoduo/agent public exports', () => {
  it('keeps recovery orchestration in Core and PostgreSQL infrastructure in its subpath', () => {
    expect(agentCore).toHaveProperty('createAgentHarness');
    expect(agentCore).toHaveProperty('createAgentRecoveryWorker');
    expect(agentCore).not.toHaveProperty('createPostgresAgentRuntimeStore');
    expect(agentCore).not.toHaveProperty('migrateAgentRuntime');

    expect(postgres).toHaveProperty('createPostgresAgentRuntimeStore');
    expect(postgres).toHaveProperty('migrateAgentRuntime');
    expect(postgres).toHaveProperty('getAgentRuntimeMigrationStatus');
  });
});
