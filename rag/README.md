# 本地 Milvus

这套配置用于本地 RAG 开发，使用 Docker Compose 启动 Milvus Standalone、etcd 和 MinIO。它只监听本机地址，不接入项目的 `pnpm dev`，也不包含 Embedding、Collection 或检索业务代码。

## 前置条件

- Docker Desktop 已安装并正在运行。
- macOS 的 Docker VM 至少分配 2 个 vCPU 和 8 GB 初始内存。
- 本地磁盘有足够空间保存 Milvus、etcd 和 MinIO 数据。

本配置适合本地开发，不提供生产环境的鉴权、备份或高可用能力。

## 文件与服务

| 服务         | 作用              | 宿主机端口      |
| ------------ | ----------------- | --------------- |
| `standalone` | Milvus 向量数据库 | `19530`、`9091` |
| `etcd`       | Milvus 元数据存储 | 不暴露          |
| `minio`      | Milvus 对象存储   | 不暴露          |

Compose 项目名为 `duoduo-rag`。容器、网络和数据卷由 Compose 自动按项目名隔离，不设置固定 `container_name` 或全局网络名。

MinIO 只在 Compose 内部网络提供服务，因此不会占用根目录 `compose.minio.yml` 使用的 `9000/9001` 端口。

## 启动

所有命令都从当前 `rag/` 目录执行。

不需要自定义配置时，可以直接启动：

```bash
docker compose config
docker compose up -d
docker compose ps
```

如需覆盖镜像、端口或 MinIO 本地凭据，先创建 `.env`：

```bash
cp .env.example .env
docker compose config
docker compose up -d
docker compose ps
```

`.env` 已被仓库忽略，不要提交真实凭据。`MILVUS_MINIO_USER` 和 `MILVUS_MINIO_PASSWORD` 会同时注入 MinIO 与 Milvus，两侧必须保持一致。

查看 Milvus 日志：

```bash
docker compose logs -f standalone
```

## 访问与验证

Milvus WebUI：<http://127.0.0.1:9091/webui/>

后续应用默认使用以下连接地址：

```text
http://127.0.0.1:19530
```

不安装 SDK 也可以用下面的命令验证服务：

```bash
curl -fsS http://127.0.0.1:9091/healthz

curl -fsS -X POST http://127.0.0.1:19530/v2/vectordb/collections/list \
  -H 'Content-Type: application/json' \
  -H 'Request-Timeout: 10' \
  -d '{}'
```

两个请求都应返回 HTTP 2xx；第二个请求应返回合法 JSON，新实例通常返回空 Collection 列表。

如果 `.env` 修改了 `MILVUS_HOST_PORT` 或 `MILVUS_WEBUI_HOST_PORT`，验证命令和连接地址也要改用对应的宿主机端口。容器内部端口仍保持 `19530` 和 `9091`。

## 停止与数据

停止服务但保留数据：

```bash
docker compose down
```

查看 `duoduo-rag` 项目的数据卷：

```bash
docker volume ls --filter label=com.docker.compose.project=duoduo-rag
```

清空本地 Milvus、etcd 和 MinIO 数据：

```bash
docker compose down -v
```

`down -v` 会删除本套 Compose 的数据卷。执行前请确认不再需要其中的数据；需要保留的数据应先备份。

## 常见问题

### Docker 未运行

启动 Docker Desktop 后重新执行 `docker compose up -d`。

### 端口被占用

在 `.env` 中修改 `MILVUS_HOST_PORT` 或 `MILVUS_WEBUI_HOST_PORT`，只修改宿主机端口，不修改容器内部端口。

### Milvus 尚未就绪

Milvus 首次启动可能需要初始化。查看状态和日志：

```bash
docker compose ps
docker compose logs standalone
```

等 `standalone` 通过健康检查后，再执行 `healthz` 和 Collection REST 请求。

### MinIO 鉴权失败

确认 `MILVUS_MINIO_USER` 和 `MILVUS_MINIO_PASSWORD` 同时映射给 MinIO 与 Milvus，并且两侧值完全一致。修改已有实例的凭据后，必要时先备份数据，再执行 `docker compose down -v` 重新初始化。
