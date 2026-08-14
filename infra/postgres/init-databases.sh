#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 \
  --dbname "${PGDATABASE:-${PGUSER}}" \
  --set=agent_password="${AGENT_POSTGRES_PASSWORD}" <<'SQL'
SELECT format('CREATE ROLE duoduo_agent LOGIN PASSWORD %L', :'agent_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'duoduo_agent')\gexec

SELECT 'CREATE DATABASE duoduo_agent OWNER duoduo_agent'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'duoduo_agent')\gexec

SELECT 'CREATE DATABASE duoduo_agent_test OWNER duoduo_agent'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'duoduo_agent_test')\gexec
SQL
