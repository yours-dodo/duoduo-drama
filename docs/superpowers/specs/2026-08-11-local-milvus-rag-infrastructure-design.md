# 本地 Milvus RAG 基础设施设计

## 背景

项目后续需要为 RAG 能力提供本地向量数据库。仓库根目录已经存在 PostgreSQL 和 MinIO 的本地 Compose 配置，但当前还没有 RAG 基础设施目录，也不应在第一步就把向量数据库耦合进 NestJS Server 或 `pnpm dev`。

Milvus 官方当前支持通过 Docker Compose 部署 Standalone 实例。v3.0.0 的默认部署由 Milvus、etcd 和 MinIO 组成，消息队列使用内置 Woodpecker。该方案适合当前本地开发阶段，后续仍可替换为外部对象存储、外部元数据服务或分布式部署。

## 目标

- 在根目录新增 `rag/` 目录。
- 提供可重复启动的本地 Milvus Standalone 部署配置。
- 持久化 Milvus 的本地开发数据。
- 避免与仓库现有 PostgreSQL、MinIO 配置发生端口或生命周期冲突。
- 提供启动、停止、检查、查看 WebUI 和清理数据的文档。
- 为后续应用接入预留稳定的本地连接地址，但本次不实现 RAG 业务代码。

## 非目标

- 不接入 `apps/server`、`agent/` 或任何前端应用。
- 不安装 Milvus SDK。
- 不创建 Collection、Embedding、切分或检索逻辑。
- 不修改根目录 `pnpm dev`，不让 Milvus 随应用开发命令自动启动。
- 不提供生产环境部署、鉴权、备份或高可用方案。

## 方案决策

采用自包含的 Compose 配置，放在 `rag/` 目录中：

```text
rag/
├── docker-compose.yml
├── .env.example
└── README.md
```

### 服务边界

```text
本机客户端 / 后续应用
          │
          ├── 127.0.0.1:19530 ──> milvus-standalone
          └── 127.0.0.1:9091  ──> milvus WebUI / 健康检查

milvus-standalone ──> etcd   （Compose 内部网络）
milvus-standalone ──> minio  （Compose 内部网络）
```

- `milvus-standalone` 是唯一对宿主机提供服务的容器。
- `etcd` 仅用于 Milvus 元数据，不映射宿主机端口。
- `minio` 仅作为 Milvus 的对象存储，不映射宿主机端口，因此不会占用根目录 `compose.minio.yml` 使用的 `9000/9001`。
- 使用独立的服务名、网络和 named volumes，避免与仓库其他 Compose 文件共享容器或数据。
- 宿主机端口绑定到 `127.0.0.1`，默认只允许本机访问。

### 版本与配置

- Milvus 使用固定版本标签，不使用 `latest`，默认跟随官方 v3.0.0 Standalone Compose 配置。
- etcd、MinIO 和 Milvus 的版本组合以官方 Compose 配置为基准，避免手工拼出不兼容的依赖版本。
- `.env.example` 只包含非敏感的配置模板和本地开发占位凭据；真实 `.env` 不提交。
- 主机端口允许通过环境变量覆盖，以便处理本机已有端口占用。

### 数据持久化

使用三个独立的 Docker named volumes：

- `duoduo-rag-etcd`
- `duoduo-rag-minio`
- `duoduo-rag-milvus`

普通的 `docker compose down` 只停止并移除容器，不删除这些数据卷。只有用户明确执行 `docker compose down -v` 时才清理本地数据，README 必须对此给出醒目警告。

## 使用方式

README 提供以下标准流程（从 `rag/` 目录执行）：

```bash
docker compose -f docker-compose.yml up -d
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs -f milvus
docker compose -f docker-compose.yml down
```

如果没有自定义配置，应能通过 Compose 默认值直接启动；复制 `.env.example` 为 `.env` 后，Compose 会自动读取其中的覆盖值。README 还需要说明：

- Docker Desktop 必须正在运行。
- macOS Docker VM 至少分配 2 个 vCPU 和 8 GB 初始内存。
- WebUI 地址为 `http://127.0.0.1:9091/webui/`。
- 后续本地应用默认连接地址为 `http://127.0.0.1:19530`。
- 端口被占用时如何通过 `.env` 覆盖。
- 如何查看容器日志并判断服务是否仍在初始化。
- `down` 和 `down -v` 的数据保留差异。

## 失败处理

- Docker 未运行：启动 Docker Desktop 后重新执行 Compose 命令。
- Compose 配置有误：先执行 `docker compose config`，修复环境变量或 YAML 配置后再启动。
- 端口冲突：修改 `.env` 中的宿主机端口，不修改容器内部端口。
- 资源不足：增加 Docker Desktop 的 CPU 和内存配额，检查磁盘空间。
- 容器启动但 Milvus 尚未就绪：通过 `docker compose ps` 和 Milvus 健康接口确认，必要时查看 `milvus` 日志。
- 数据损坏或需要全新实例：明确提示用户先备份需要的数据，再执行 `docker compose down -v` 并重新启动。

## 验证与验收标准

### 静态验证

- `docker compose config` 成功解析默认配置。
- 端口、网络、依赖关系和 named volumes 定义完整。
- `.env` 和本地生成数据不会被 Git 纳入版本控制。
- 新增文档通过 Prettier 检查，且文件使用 UTF-8、LF 和结尾换行。

### 运行验证

- `docker compose up -d` 后 Milvus、etcd、MinIO 容器处于运行或健康状态。
- `127.0.0.1:19530` 可以作为 Milvus 客户端连接地址。
- `127.0.0.1:9091/webui/` 可以访问。
- `docker compose down` 后重新启动，既有数据卷仍被复用。
- 根目录的 PostgreSQL 和 MinIO Compose 配置可以独立运行，不因本次配置发生端口冲突。

## 后续扩展

后续真正接入 RAG 时，在应用边界内新增 Milvus 连接适配器、Collection 生命周期管理、Embedding 生成和检索服务；这些内容不应直接写进本次 Compose 文件，也不应让业务代码依赖 `rag/` 内部的实现细节。

## 参考资料

- [Milvus：Run Milvus with Docker Compose](https://milvus.io/docs/install_standalone-docker-compose.md)
- [Milvus：Requirements for Installing Milvus Standalone](https://milvus.io/docs/prerequisite-docker.md)
