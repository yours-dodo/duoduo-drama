# Asset 上传与 MinIO 对象存储设计

## 1. 背景

当前 Server 已经具备用户、团队租户、故事项目和项目级授权能力，但还没有文件素材模型和对象存储边界。Roadmap 的第一条可验证业务链路需要支持用户上传图片，并将图片交给后续的图片分析、Storyboard 和 Agent Workflow。

本切片只建立素材上传基础设施，不实现图片分析、RAG、Redis/BullMQ、视频生成或 Agent 业务调用。

## 2. 目标

- 为故事项目建立租户隔离的 `Asset` 元数据。
- 通过 Server 统一完成权限校验、Asset 创建和上传确认。
- 使用预签名 URL，让浏览器直接把文件上传到 MinIO，不经过 Server 进程中转。
- 将 MinIO 隐藏在小而稳定的对象存储接口之后。
- 为后续 Agent、RAG 和 Artifact 流程提供稳定的 Asset 引用。
- 让本地开发可以通过 Compose 启动 MinIO，并且不依赖真实生产凭证。

## 3. 非目标

本切片不包含：

- 图片内容理解、OCR 或安全模型。
- 剧本/PDF 等文档的解析和导入。
- Redis、BullMQ 和异步 Worker。
- Milvus、Embedding 和 RAG 索引。
- Agent 直接访问 Server 数据库。
- 视频、音频、字幕和渲染 Artifact。
- 公开 Bucket 或客户端自定义对象 Key。

## 4. 方案选择

### 4.1 推荐方案：Server Storage Facade

Server 是素材元数据、租户归属和项目权限的权威入口，MinIO 只保存文件内容。

```text
Web
  │
  ├─ POST upload-url ────────> Server
  │                            ├─ 校验 TenantContext
  │                            ├─ 校验 StoryProject 访问权限
  │                            ├─ 创建 pending_upload Asset
  │                            └─ 生成预签名 PUT URL
  │
  ├─ PUT 文件 ────────────────> MinIO
  │
  └─ POST complete ──────────> Server
                               ├─ HEAD 校验 MinIO 对象
                               └─ 将 Asset 标记为 uploaded
```

该方案把业务权限和对象存储细节集中在 Server，浏览器不会直接管理 Bucket 或对象 Key。Agent 后续只接收经过 Server 授权的 Asset 引用，不读取 Server 数据库。

### 4.2 不采用：客户端直接持有 MinIO 逻辑

虽然可以减少 Server 接口，但会把租户权限、对象 Key、上传失败和状态同步分散到客户端，难以保证跨 Web、移动端和 Agent 的一致性。

### 4.3 暂不采用：抽取 `packages/object-storage`

当前只有 Server 是真实消费者。按照仓库约定，先在 Server 内建立深模块和适配器；当 Agent 也需要同一稳定接口时，再评估抽取共享包。

## 5. 模块和目录

```text
apps/server/src/
├── modules/assets/
│   ├── application/
│   │   ├── complete-asset-upload.ts
│   │   ├── create-asset-upload-url.ts
│   │   ├── delete-asset.ts
│   │   └── list-project-assets.ts
│   ├── http/
│   │   ├── assets.controller.ts
│   │   └── asset.dto.ts
│   ├── infrastructure/
│   │   └── prisma-asset.repository.ts
│   ├── ports/
│   │   └── asset-repository.ts
│   └── assets.module.ts
└── platform/object-storage/
    ├── object-storage.ts
    ├── object-storage.module.ts
    └── s3/
        └── s3-object-storage.ts
```

`modules/assets` 只依赖 `ObjectStorage` 接口和 Asset Repository，不导入 MinIO 或 AWS SDK 类型。`platform/object-storage` 负责连接、预签名、对象元数据读取和删除等基础能力。

实现使用 S3-compatible 接口连接本地 MinIO。默认采用 AWS SDK v3 的 S3 Client 和预签名包，使未来切换到 S3-compatible 服务时不需要修改业务模块。

## 6. Asset 数据模型

第一版 Asset 绑定当前已有的 `StoryProject`，避免在尚未建立短剧项目模型前引入多态归属。

```text
Asset
├── id                  UUID
├── tenantId            UUID
├── projectId           UUID
├── uploadedByUserId    UUID
├── objectKey           string, unique
├── originalFileName    string
├── contentType         string
├── byteSize            integer
├── checksum            string, nullable, server-verified only
├── status              enum-like string
├── uploadExpiresAt     timestamp
├── completedAt         timestamp, nullable
├── createdAt           timestamp
└── updatedAt           timestamp
```

关系和约束：

- `tenantId` 必须与 `StoryProject.tenantId` 一致。
- `projectId` 通过租户复合关系指向故事项目。
- `uploadedByUserId` 必须是该租户内的有效成员。
- `objectKey` 由 Server 生成并唯一，不接受客户端提供。
- `checksum` 只有在对象存储适配器返回可验证值时才落库；客户端声明值不会直接成为可信 checksum。
- 项目删除或归档策略在 Asset 切片中只保留接口，不自动执行批量对象删除。
- Asset 列表和单条查询都必须显式带 `tenantId`。

### 6.1 状态

```text
pending_upload → uploaded
pending_upload → failed
uploaded       → deleted
```

- 创建上传会话后写入 `pending_upload`。
- Server 确认对象存在、大小和声明类型符合请求后变为 `uploaded`。
- 预签名 URL 过期、对象缺失或校验不匹配时标记为 `failed`，不删除其他 Asset。
- 删除操作只允许从 `uploaded` 进入 `deleted`，并在对象删除成功后更新元数据。

第一版不引入 `processing`，内容分析状态属于后续 Agent Workflow，不与文件上传状态混合。

## 7. 对象 Key 和上传策略

对象 Key 由 Server 根据租户、项目和 Asset ID 生成：

```text
tenants/{tenantId}/story-projects/{projectId}/assets/{assetId}/original
```

原始文件名只保存为展示元数据，不直接拼入对象 Key。这样可以避免路径穿越、特殊字符和重名覆盖。

第一版允许的文件类型：

- `image/jpeg`
- `image/png`
- `image/webp`

第一版限制：

- 单个文件最大 20 MiB。
- 单个项目的单次上传请求最多创建 1 个 Asset；客户端可并行创建 1–6 个上传会话。
- 预签名 URL 默认 10 分钟有效。
- 生成 URL 时只允许 Server 选择的 Content-Type 和声明大小范围；具体签名约束由 Adapter 能力决定，`complete` 的对象大小校验始终是最终依据。
- Server 不接收文件二进制，不记录文件内容和签名 URL。

文件头校验和内容安全扫描属于后续素材处理切片。当前 `complete` 至少通过 MinIO `HEAD` 校验对象存在、大小和声明类型；不能把客户端传入的 Content-Type 视为已完成内容安全验证。

## 8. 对象存储接口

业务模块通过一个小接口使用对象存储：

```ts
interface ObjectStorage {
  createUploadUrl(input: {
    objectKey: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<{
    url: string;
    expiresAt: string;
    requiredHeaders: Readonly<Record<string, string>>;
  }>;

  headObject(objectKey: string): Promise<{
    contentType?: string;
    contentLength: number;
    etag?: string;
  }>;

  createDownloadUrl(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: string }>;

  deleteObject(objectKey: string): Promise<void>;
}
```

MinIO/S3 SDK 的错误、命令对象、Bucket 配置和路径风格设置都隐藏在 Adapter 内。接口只表达业务需要的对象操作和错误语义。

## 9. HTTP 接口

沿用当前 Server 的版本化和团队/项目路径：

```text
POST /api/v1/teams/:teamId/story-projects/:projectId/assets/upload-url
POST /api/v1/teams/:teamId/story-projects/:projectId/assets/:assetId/complete
GET  /api/v1/teams/:teamId/story-projects/:projectId/assets
DELETE /api/v1/teams/:teamId/story-projects/:projectId/assets/:assetId
```

### 9.1 创建上传 URL

请求：

```json
{
  "fileName": "travel-photo.png",
  "contentType": "image/png",
  "byteSize": 1048576
}
```

响应至少包含：

```json
{
  "assetId": "uuid",
  "status": "pending_upload",
  "uploadUrl": "signed-url",
  "expiresAt": "timestamp",
  "requiredHeaders": {
    "content-type": "image/png"
  }
}
```

处理顺序：

1. 解析并验证 `teamId` 和 `projectId`。
2. 通过 `TenantContext` 验证团队成员身份。
3. 复用 Story Project 的项目访问策略验证上传权限。
4. 校验文件名、类型和大小。
5. 创建 `pending_upload` Asset。
6. 生成 Server 控制的对象 Key 和预签名 URL。

### 9.2 完成上传

请求可以为空。Server 以 MinIO `HEAD` 结果为基础完成存在性、大小和类型校验；客户端声明的 checksum 如果未来需要接收，也只能作为待验证输入，不能直接写入可信 checksum 字段。

重复调用完成接口必须是幂等的：已是 `uploaded` 时返回同一个 Asset；状态为 `failed` 或 `deleted` 时拒绝再次完成。

### 9.3 列出项目素材

只返回当前租户和项目下的 Asset 元数据，不返回永久对象凭证。下载能力由后续单独的预签名下载接口提供，避免把上传和下载授权混为一体。

### 9.4 删除项目素材

```text
DELETE /api/v1/teams/:teamId/story-projects/:projectId/assets/:assetId
```

删除必须复用项目访问策略。Server 先确认 Asset 属于当前租户和项目，再删除对象；对象删除成功或对象本身已经不存在后，将 Asset 标记为 `deleted`。已删除 Asset 的重复删除请求返回幂等成功，`pending_upload` 和 `failed` Asset 也可以被清理，但不能重新完成上传。

## 10. 租户隔离与安全

- 所有入口都通过 `TenantContext` 建立租户范围。
- `projectId` 必须从 `teamId` 对应的项目中解析，不能只按项目 UUID 查询。
- Asset Repository 的查询条件显式包含 `tenantId`。
- MinIO 使用专用 Server 用户和专用 Bucket，不使用 Root 用户运行 Server。
- Bucket 默认禁止匿名读写。
- 预签名 URL 不写入日志、数据库或审计摘要。
- 原始文件名、对象 Key 和用户输入只在必要范围内记录，不记录文件内容。
- 客户端永远不能自定义 Bucket、对象 Key 或权限策略。
- Agent 后续访问素材时使用受限的对象引用或短期下载 URL，不获得 Server 数据库凭证。

## 11. 配置与本地 MinIO

Server 配置项：

```text
SERVER_OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000
SERVER_OBJECT_STORAGE_REGION=us-east-1
SERVER_OBJECT_STORAGE_ACCESS_KEY=duoduo_server
SERVER_OBJECT_STORAGE_SECRET_KEY=change-me
SERVER_OBJECT_STORAGE_BUCKET=duoduo-assets
SERVER_OBJECT_STORAGE_PRESIGNED_TTL_SECONDS=600
SERVER_OBJECT_STORAGE_FORCE_PATH_STYLE=true
```

本地 Compose 只启动 MinIO 和 Console，使用独立的开发账号。生产部署不自动创建 Bucket、不自动应用迁移；部署脚本或运维流程负责准备 Bucket、策略和凭证。

## 12. 测试策略

### 单元测试

- 文件类型、大小和扩展名策略。
- 对象 Key 生成和路径安全。
- Asset 状态转换。
- `ObjectStorage` 错误映射。
- 预签名 URL 响应映射。

### Server 应用和 HTTP 测试

- 无效租户、无权项目和跨租户项目均拒绝。
- 创建上传 URL 会写入 `pending_upload`。
- 完成上传会校验对象存在、大小和 Content-Type。
- 重复完成请求保持幂等。
- 过期、缺失或不匹配对象进入 `failed`。
- 已上传对象可以被授权成员删除，重复删除保持幂等。
- 列表不会泄露其他租户 Asset。

### PostgreSQL 集成测试

- Asset 的租户、项目、成员复合约束。
- Asset Repository 的分页和状态过滤。
- 上传确认与 Asset 状态更新的事务边界。

### MinIO 集成测试

第一版默认不要求本地 MinIO 才能通过常规测试。Adapter 使用假的 S3 Client 覆盖成功和失败路径；专门的可选集成命令再连接 Compose MinIO，验证真正的预签名上传和 HEAD 行为。

## 13. 验收标准

- 成员可以为有权限的故事项目创建图片上传会话。
- 浏览器可以使用预签名 URL 直接上传到 MinIO。
- Server 可以确认上传对象并将 Asset 标记为 `uploaded`。
- 不同租户不能读取、确认或列出彼此的 Asset。
- Server 进程不接收图片二进制。
- 重复完成请求不会创建重复 Asset 或重复状态转换。
- 删除、过期和对象缺失都有明确错误语义。
- Server 单元、HTTP、PostgreSQL 测试通过；可选 MinIO 集成测试可独立运行。
- 未来 Agent 可以只依赖 Asset ID、租户范围和对象存储接口，不依赖 Server Prisma Client。

## 14. 后续演进

本切片完成后按以下顺序扩展：

1. 为 Asset 增加异步内容分析状态和 ImageAnalysis。
2. 增加 Redis/BullMQ Worker，处理分析和生成任务。
3. 增加 Artifact、ShotVersion 和版本血缘。
4. 由 Agent 通过显式对象引用读取素材。
5. 需要风格包检索时，再增加 RAG 和 Milvus Adapter。

MinIO 存储原始文件和 Artifact，PostgreSQL 保存权威元数据，Milvus 只保存可重建的向量索引，三者不混用。
