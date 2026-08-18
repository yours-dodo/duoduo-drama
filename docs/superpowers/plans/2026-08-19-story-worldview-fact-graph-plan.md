# 世界构成事实关系图实施计划

设计依据：`docs/superpowers/specs/2026-08-19-story-worldview-fact-graph-design.md`

## 实现边界

- 只修改 Web 端故事世界观工作区，不接入 Server、数据库、向量索引或真实持久化。
- 继续使用 Vue 和现有设计系统，不新增关系图库依赖。
- 保留地点、组织、角色、规则四类实体字段和富文本补充说明。
- 关系图只读；事实关系只能在关系清单中新增、编辑和删除。
- 系统核心 predicate 只读，项目 predicate 可新增和停用。

## 任务切片

### 1. 用回归测试锁定现有实体能力

- 保留四类实体目录、类型专属字段和角色资产引用测试。
- 保留稳定 ID、重命名引用、删除保护和序列化测试。
- 增加“旧关系数据可转换为 fact statement”的迁移测试，避免重构丢失种子关系。

### 2. 建立统一图领域模型

在 `story-worldview-ontology.ts` 中引入 class、entity、predicate 三类节点，以及 schema、fact 两类 statement。

提供纯函数：

- 创建种子知识图；
- 读取全部 schema 或 fact statement；
- 解析 predicate 的源类型、目标类型和反向关系；
- 根据 Ontology 过滤合法源实体和目标实体；
- 校验、保存和删除事实；
- 按实体筛选传入和传出事实；
- 派生只读关系图节点与边；
- 生成 AI/RAG 使用的事实上下文；
- 检查实体和 predicate 的引用完整性。

### 3. 实现只读事实关系图

新增 `StoryWorldviewFactGraph.vue`：

- 展示全部实体节点和 fact 连线，不展示 schema 节点或 schema 连线；
- 使用稳定、确定性的纯函数布局，不保存图形位置；
- 点击节点发出实体选择事件；
- 选中实体后突出相关节点和边；
- 点击空白或“清除筛选”恢复全量状态；
- 不提供拖线、边编辑或删除操作；
- 图布局不可用时显示清单可继续编辑的降级提示。

### 4. 实现事实关系清单

新增 `StoryWorldviewFactLedger.vue`：

- 默认展示全部 fact；选择实体后筛选其传入和传出事实；
- 使用清单内编辑行新增事实；
- 先选择 predicate，再按 schema 过滤源实体和目标实体；
- 支持编辑、取消、保存和删除；
- 显示重复事实、停用 predicate、类型冲突和悬空引用错误；
- 只操作 fact statement，不修改 schema。

### 5. 实现实体抽屉与 Ontology 管理入口

- 将现有 `StoryWorldviewEntityEditor.vue` 放入 `StoryWorldviewEntityDrawer.vue`，目录不再切换到实体详情主页面。
- 新增 `StoryWorldviewOntologyManager.vue`，展示只读系统 predicate，并允许创建、编辑或停用项目 predicate。
- 已被事实引用的项目 predicate 只能停用，不能删除。
- Ontology 管理器只写 predicate 节点和 schema statement。

### 6. 重构世界构成工作区与响应式样式

在 `StoryWorldviewWorkspace.vue` 中组合：

- 左侧实体目录；
- 主区上方只读事实图；
- 主区下方事实关系清单；
- 实体属性抽屉；
- 独立 Ontology 管理面板。

桌面端保持目录与主区并列。窄屏按目录、事实图、事实清单顺序纵向排列，抽屉和管理面板使用全宽覆盖层。保留现有深色编辑室视觉，不引入圆角卡片化风格。

### 7. 测试和浏览器验证

- Vitest 覆盖统一图模型、schema/fact 区分、约束校验、筛选、上下文生成和删除保护。
- 组件或结构测试覆盖只读图、事实清单、实体抽屉和 Ontology 管理入口。
- 运行 Web test、typecheck、build、定向 ESLint、Prettier 和 `git diff --check`。
- 浏览器验证默认全量事实、节点筛选、清除筛选、清单新增/编辑/删除、Ontology 约束错误、桌面与 390px 窄屏布局。
- 检查页面运行时 error/warning 日志。
