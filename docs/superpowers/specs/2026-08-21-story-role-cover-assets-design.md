# 角色资产封面图设计

日期：2026-08-21

状态：已确认，待实现

## 背景

角色资产编辑页当前只有文字设定入口，没有封面图设置入口。项目已经存在通用 Asset 上传和对象存储抽象，但现有 Asset HTTP 接口只覆盖团队项目，Asset 数据模型也要求 `tenant_id` 非空；而角色资产已经支持个人项目，因此封面能力必须同时覆盖个人项目和团队项目。

## 目标与非目标

### 目标

- 在角色编辑页提供本地图片上传、上传进度、预览、替换和移除入口。
- 复用项目通用 Asset 与对象存储，不在角色表中保存外部 URL。
- 角色只能绑定同一项目、已完成上传、且为支持图片类型的 Asset。
- 个人项目和团队项目遵循相同的上传、授权和读取语义。
- 角色列表卡片可以显示封面缩略图，没有封面时保留默认占位。

### 非目标

- 本次不做图片裁剪、压缩、AI 生成或多图相册。
- 本次不删除项目通用素材；替换或移除封面只解除角色绑定。
- 本次不改变已有 Asset 的对象存储文件内容和已完成素材记录。

## 方案

角色资产增加可空 `cover_asset_id`，指向项目通用 Asset。上传流程分为三个明确阶段：申请上传地址、客户端直传并完成 Asset、绑定角色。

```text
选择图片
  -> POST /assets/upload-url
  -> PUT object-storage uploadUrl
  -> POST /assets/{assetId}/complete
  -> PATCH /role-assets/{roleId} { coverAssetId: assetId }
  -> GET role-assets/{roleId} 返回封面元数据和短期 downloadUrl
```

绑定阶段由 Server 再次校验 Asset 的项目、租户、上传用户可见范围、状态和图片类型，不能仅依赖客户端传入的 Asset ID。

## 数据模型

### `story_role_assets`

新增：

- `cover_asset_id UUID NULL`
- 通过 Asset 主键外键保证素材存在，并通过租户与项目作用域约束避免绑定到其他项目；应用层同时校验同一 `tenant_id`、`project_id`。
- 保留 `NULL` 表示没有封面。

角色查询输出增加：

```ts
coverAsset: {
  id: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  downloadUrl: string;
  downloadUrlExpiresAt: string;
} | null
```

### `assets`

为支持个人项目，将 `tenant_id` 调整为可空：

- 团队项目继续绑定 `teams` 和 `team_memberships`。
- 个人项目 `tenant_id = NULL`，通过 `(tenant_id, project_id)` 关联个人项目。
- Asset 的 `project_id` 仍必须指向真实项目，避免个人项目出现悬空素材。
- 对象 Key 使用带作用域的前缀：团队沿用 `tenants/{tenantId}/...`，个人使用 `personal/story-projects/{projectId}/...`。

现有已完成团队 Asset 的数据不迁移对象 Key，仅放宽字段约束并兼容新个人 Asset。

## Server API

### 通用 Asset

团队路径保持现有形式，并新增个人路径：

- `POST /api/v1/teams/:teamId/story-projects/:projectId/assets/upload-url`
- `POST /api/v1/teams/:teamId/story-projects/:projectId/assets/:assetId/complete`
- `GET /api/v1/teams/:teamId/story-projects/:projectId/assets`
- `GET /api/v1/teams/:teamId/story-projects/:projectId/assets/:assetId/download-url`
- `POST /api/v1/me/story-projects/:projectId/assets/upload-url`
- `POST /api/v1/me/story-projects/:projectId/assets/:assetId/complete`
- `GET /api/v1/me/story-projects/:projectId/assets`
- `GET /api/v1/me/story-projects/:projectId/assets/:assetId/download-url`

上传限制沿用现有策略：JPEG、PNG、WebP，最大 20 MiB。下载地址为短期签名 URL，不直接暴露对象存储 Key。

### 角色资产

角色创建不需要封面；角色更新增加：

```json
{
  "expectedRevision": 2,
  "coverAssetId": "uuid-or-null"
}
```

`coverAssetId` 只能是当前项目内状态为 `uploaded` 的支持图片 Asset；不合法时返回资源归属或状态错误。更新成功后 revision 按现有乐观锁规则递增，清空封面也写入审计摘要。

角色详情和列表输出封面元数据及短期下载地址。若签名地址生成失败，接口返回明确错误且不返回失效 URL，不降级为外部 URL。

## Web 交互

### 编辑页

在角色基础字段上方增加“角色封面”卡片：

- 无封面：显示占位图和“上传封面”按钮。
- 选择文件后：先展示本地预览，并显示上传进度。
- 上传完成后：显示服务端返回的图片预览，等待角色保存时绑定。
- 已有封面：提供“替换”和“移除”。替换成功但角色保存失败时，保留旧绑定，提示用户重试。
- 上传按钮在非图片、超过 20 MiB、上传中或保存中时禁用并展示原因。

### 列表页

角色卡片使用 Server 返回的 `coverAsset.downloadUrl` 显示缩略图；没有封面时继续使用现有默认视觉占位。图片加载失败只影响图片区域，不阻断角色文字信息和编辑入口。

## 错误与生命周期

- 上传 URL 创建失败：不进入直传阶段，可重试。
- 对象直传或完成失败：Asset 标记失败，角色旧封面不变。
- 绑定失败：角色 revision 不变，已上传但未绑定的 Asset 保留为项目素材，后续由项目素材管理清理。
- 替换/移除：只更新角色绑定和审计，不删除 Asset 或对象。
- 并发保存：继续使用 `expectedRevision`，返回 409 时要求重新加载。
- 权限：个人项目按项目所有者权限，团队项目按现有团队成员与协作者权限；上传、完成、绑定、下载都做服务端授权。

## 测试与验收

### Server

- Asset 个人项目上传 URL、完成、列表、下载签名接口。
- 团队/个人跨项目和跨租户 Asset 绑定拒绝。
- 非图片、超大小、未完成 Asset、已删除 Asset 绑定拒绝。
- 角色封面设置、替换、移除和 revision 冲突。
- 角色输出包含短期下载 URL；对象存储异常返回明确错误。
- PostgreSQL migration 验证可空租户、复合外键和封面字段。

### Web

- 编辑页出现上传入口并正确显示状态。
- 上传完成后保存角色绑定封面，刷新仍显示封面。
- 替换、移除、上传失败和保存冲突状态可恢复。
- 角色列表显示封面或默认占位，图片加载失败不影响文字卡片。

## 风险与取舍

- 放宽 Asset 的 `tenant_id` 会触及现有 Asset 授权和 Repository 类型，需要确保所有团队行为保持不变；通过分离个人/团队授权分支和 PostgreSQL 边界测试控制风险。
- 列表返回短期签名 URL 会产生过期问题；前端在重新加载角色列表或详情时重新获取，暂不做长期缓存。
- 上传后保存前可能产生未绑定 Asset；本次保留项目素材，由后续素材清理策略统一回收，避免误删共享资源。
