import type { Pool } from 'pg';

export type PostgresAgentRuntimeOptions =
  { readonly connectionString: string } | { readonly pool: Pool };
