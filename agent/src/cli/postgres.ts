import { AgentError } from '../core/errors.js';
import {
  getAgentRuntimeMigrationStatus,
  migrateAgentRuntime,
} from '../infrastructure/postgres/index.js';

const command = process.argv[2];
const connectionString = process.env.AGENT_RUNTIME_DATABASE_URL?.trim();

if (!connectionString) {
  console.error(
    'AGENT_MIGRATION_FAILED: AGENT_RUNTIME_DATABASE_URL is required',
  );
  process.exitCode = 1;
} else {
  try {
    if (command === 'migrate') {
      await migrateAgentRuntime({ connectionString });
      console.log('Agent Runtime migrations applied.');
    } else if (command === 'status') {
      const status = await getAgentRuntimeMigrationStatus({ connectionString });
      for (const migration of status.migrations)
        console.log(
          `${migration.version} ${migration.state.padEnd(17)} ${migration.name}`,
        );
      if (
        status.migrations.some(
          (migration) =>
            migration.state === 'checksum_mismatch' ||
            migration.state === 'missing_file',
        )
      )
        process.exitCode = 1;
    } else {
      console.error('Usage: postgres.ts <migrate|status>');
      process.exitCode = 1;
    }
  } catch (error) {
    const failure =
      error instanceof AgentError
        ? error
        : new AgentError(
            'AGENT_MIGRATION_FAILED',
            'Agent Runtime migration failed',
          );
    console.error(`${failure.code}: ${failure.message}`);
    process.exitCode = 1;
  }
}
