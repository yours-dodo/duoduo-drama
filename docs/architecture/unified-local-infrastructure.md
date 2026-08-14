# Unified Local Infrastructure

`compose.dev.yml` provides the local infrastructure required by the Web, Server, Agent, and future RAG, search, and event workflows.

## Services

| Service         | Purpose                                          | Host address                                   |
| --------------- | ------------------------------------------------ | ---------------------------------------------- |
| `postgres`      | Server database and shared local PostgreSQL host | `127.0.0.1:5432`                               |
| `postgres-init` | Idempotently creates Agent databases             | one-shot helper                                |
| `minio`         | Business asset object storage                    | API `127.0.0.1:9000`, console `127.0.0.1:9001` |
| `milvus`        | RAG vector database                              | `127.0.0.1:19530`, Web UI `127.0.0.1:9091`     |
| `milvus-etcd`   | Milvus metadata store                            | internal only                                  |
| `milvus-minio`  | Milvus object storage                            | internal only                                  |
| `elasticsearch` | Local single-node search index                   | `127.0.0.1:9200`                               |
| `kafka`         | Local single-node KRaft broker                   | host `127.0.0.1:29092`, Compose `kafka:9092`   |

PostgreSQL keeps ownership boundaries separate with `duoduo_server`, `duoduo_agent`, and `duoduo_agent_test` databases. Server and Agent must keep their own connection strings and migration histories even though they share one local PostgreSQL container.

## Start

From the repository root:

```bash
cp infra/.env.example .env
docker compose -f compose.dev.yml config
docker compose -f compose.dev.yml up -d
docker compose -f compose.dev.yml ps
```

The root `.env` is ignored. Change host ports there when a local port is already occupied. Do not put production credentials in this file.

The application connection examples are:

```text
Server: SERVER_DATABASE_URL=postgresql://duoduo_server:change-me@127.0.0.1:5432/duoduo_server
Agent:  AGENT_RUNTIME_DATABASE_URL=postgresql://duoduo_agent:change-me@127.0.0.1:5432/duoduo_agent
Milvus: http://127.0.0.1:19530
Elasticsearch: http://127.0.0.1:9200
Kafka from host: localhost:29092
Kafka from Compose: kafka:9092
MinIO: http://127.0.0.1:9000, bucket `duoduo-assets`
```

Run Server migrations explicitly after PostgreSQL is healthy:

```bash
pnpm --filter @duoduo/server db:migrate:deploy
```

Stop services while retaining data with `docker compose -f compose.dev.yml down`. To remove all data volumes, use `docker compose -f compose.dev.yml down -v` only after confirming that local data is disposable.

The existing `compose.postgres.yml`, `compose.minio.yml`, and `rag/docker-compose.yml` remain available for focused startup of individual infrastructure groups.
