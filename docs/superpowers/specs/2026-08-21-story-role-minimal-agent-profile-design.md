# 角色详情最小充分人物档案设计

## 背景

现有角色详情已经覆盖人物动机、角色弧光、剧情功能及结构化声音表达，但用户需要在
多个语义重叠的字段中重复描述同一人物。例如“语速快、短句、嘴损”既可能出现在
说话风格概述，也可能再次选择语速、句式、语气和用词标签。

角色 Agent 运行时还需要当前场景、情绪、剧情阶段、关系状态和认知边界，但这些信息
不应继续堆入角色详情。角色详情只保存稳定、长期有效、由创作者直接维护的人物基线；
剧情状态由后续 Agent 上下文在运行时提供。

本设计采用“平衡精简”方案，从数据库、领域模型、API 和页面同步删除重复字段，不把
旧字段隐藏为高级设置。

## 目标

- 将角色详情收缩为能够支持 LLM 理解人物基线的最小充分信息集。
- 避免用户以自由文本和枚举标签重复描述同一种性格或声音特征。
- 保留典型台词和表达习惯这两类对 LLM 最直接的信息。
- 迁移已有内容时尽量保留文本语义，不静默丢弃已有角色弧光、剧情功能或声纹规则。
- 保持现有角色权限、封面、归档和乐观锁语义不变。

## 非目标

- 不在本次接入 Agent、修改提示词或定义上下文权重。
- 不在角色详情中增加当前情绪、当前目标、当前弧光阶段或场景状态。
- 不在角色详情中增加角色知识、秘密或具体角色关系；这些属于后续剧情状态或关系资产。
- 不保留被删除字段的隐藏高级编辑入口。
- 不建立人物年表、角色关系图或独立声纹子资源。

## 最终角色模型

### 基础元数据

继续保留以下紧凑字段：

| 字段 | 展示名 | 用途 |
| --- | --- | --- |
| `name` | 角色名称 | 角色标识，继续必填 |
| `category` | 叙事定位 | 主角、核心角色、配角、背景角色 |
| `occupation` | 身份 / 职业 | 简短社会身份 |
| `gender` | 性别 | 次要元数据 |
| `camp` | 当前阵营 | 当前叙事阵营 |
| `appearanceFrequency` | 出场频率 | 控制叙事篇幅，不表示人物性格 |
| `coverAssetId` | 角色封面 | 保留现有 Asset 绑定 |

### 三个人物核心字段

| 字段 | 展示名 | 填写内容 |
| --- | --- | --- |
| `personalityCore` | 性格内核 | 核心性格、价值观、缺陷、反差及稳定行为倾向 |
| `motivationConflict` | 核心动机与矛盾 | 想得到什么、真正需要什么、害怕什么、哪些底线不会跨越 |
| `mainlineRelation` | 与主线关系 | 与主角、核心冲突和主线事件的关系，以及承担的剧情作用 |

`motivationConflict` 合并当前的 `externalGoal`、`internalNeed` 和
`fearsAndBoundaries`。`mainlineRelation` 吸收当前 `functions` 和已有
`characterArc` 文本。新的角色详情不再单独维护角色弧光；具体变化阶段由大纲或剧情
运行时上下文提供。

### 最小声音表达模型

```ts
interface StoryRoleSpeechProfile {
  style: string;
  habits: string[];
  dialogueExamples: StoryRoleDialogueExample[];
}

interface StoryRoleDialogueExample {
  context: string;
  line: string;
}
```

- `style`：自然语言描述角色整体说话方式。语速、句式、语气、用词、脏话、玩梗、
  比喻、结巴和语病都可以直接写入，不再要求重复选择标签。
- `habits`：可重复的简短表达规则，例如“紧张时会在句首重复第一个字，但面对下属
  时不会”。每条规则自行包含频率、触发和例外，不再拆成多个子字段。
- `dialogueExamples`：保留最有价值的台词样本，将场景、情绪和对象合并为一个
  `context`，每条只填写“情境”和“台词”。

空声音资料使用无语义默认值：

```ts
const EMPTY_STORY_ROLE_SPEECH_PROFILE = {
  style: '',
  habits: [],
  dialogueExamples: [],
};
```

不再使用“正常语速”和“长短混合”作为空数据默认值，避免 Agent 将未填写误解为作者
明确设定。

## 删除和合并映射

| 当前字段 | 最终处理 |
| --- | --- |
| `externalGoal` | 合并到 `motivationConflict` |
| `internalNeed` | 合并到 `motivationConflict` |
| `fearsAndBoundaries` | 合并到 `motivationConflict` |
| `characterArc` | 迁移时追加到 `mainlineRelation`，随后删除独立字段 |
| `functions` | 迁移时追加到 `mainlineRelation`，随后删除独立字段 |
| `speechProfile.summary` | 迁移为 `speechProfile.style` |
| `pace`、`sentenceStyle` | 非空且非旧默认值时转为 `style` 补充文本 |
| `defaultTones`、`vocabularyStyles` | 转为 `style` 补充文本 |
| 结构化 `habits` | 转为完整自然语言习惯字符串 |
| `audienceStyles` | 转为“面对某对象时……”的习惯字符串 |
| `prohibitions` | 转为“表达禁区：……”的习惯字符串 |
| 旧 `dialogueExamples` | 场景、情绪、对象合并为 `context`，保留 `line` |

新 API 不同时接受新旧字段。Web、Server 和数据库迁移作为同一批次发布。

## 页面信息架构

角色封面继续位于页面左侧。右侧表单只保留三个分组。

### 基础信息

角色名称、身份 / 职业、叙事定位、性别、当前阵营、出场频率。

### 人物特征

- 性格内核。
- 核心动机与矛盾。
- 与主线关系。

三个字段都使用带明确填写提示的多行文本，不再显示外在目标、内在欲望、恐惧与
底线、角色弧光和剧情功能的独立输入。

### 声音与表达

- 一个“说话方式”多行文本。
- 一个简单的表达习惯列表，每项只有一个输入。
- 一个典型台词列表，每项只有情境和台词两个输入。

页面不显示高级设置或被删除的结构化声纹选项。

## 领域和 API 契约

角色快照最终保留：

```ts
interface StoryRoleAssetSnapshot {
  id: string;
  tenantId: string | null;
  projectId: string;
  category: StoryRoleCategory;
  name: string;
  occupation: string;
  personalityCore: string;
  motivationConflict: string;
  mainlineRelation: string;
  gender: StoryRoleGender;
  camp: StoryRoleCamp;
  appearanceFrequency: StoryRoleAppearanceFrequency;
  speechProfile: StoryRoleSpeechProfile;
  coverAssetId: string | null;
  revision: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}
```

建议限制：

- `personalityCore`：最多 2,000 字。
- `motivationConflict`：最多 4,000 字，以容纳旧三个字段的无损合并。
- `mainlineRelation`：最多 8,000 字，以容纳旧主线关系、剧情功能和角色弧光。
- `speechProfile.style`：最多 2,000 字。
- `speechProfile.habits`：最多 12 条，每条最多 500 字。
- `dialogueExamples`：最多 8 条；`context` 最多 300 字，`line` 最多 500 字。

角色整体继续使用 `expectedRevision` 更新。输出时继续深复制数组和台词对象。

## 数据迁移

新增一条位于当前角色重构迁移之后的迁移：

1. 新增 `motivation_conflict` 文本列。
2. 使用带中文标签的确定格式合并非空旧字段，例如“外在目标：……”。
3. 将非空 `functions` 和 `character_arc` 以带标签段落追加到
   `mainline_relation`，避免静默丢失已有内容。
4. 将旧 `speech_profile` JSONB 转换为新结构：
   - 概述保留为 `style`。
   - 非默认标签追加为风格说明。
   - 结构化习惯、对象规则和禁区转换为自然语言习惯列表。
   - 典型台词合并情境字段并保留原台词。
5. 删除旧人物字段和 `functions` 列。
6. 更新数据库长度约束和 `speech_profile` 默认值。

迁移不得把旧空默认“正常语速、长短混合”写入新的 `style`。迁移后同一角色的非空
旧文本都应能在新字段中找到对应内容。

## 错误处理

- 继续由 DTO 拒绝未知旧字段，防止调用方误以为旧契约仍有效。
- 表达习惯允许为空数组，但数组项不得是空字符串。
- 典型台词允许为空数组；创建一项后 `line` 必填，`context` 可以为空。
- 超出长度或数量限制时继续返回现有角色字段校验错误，不新增业务错误类型。

## 测试和验收

### Server

- 创建角色时获得完整空声音结构。
- 人物字段和声音资料可以修剪、深复制和更新。
- 习惯数量、字符串长度和典型台词限制得到验证。
- DTO 拒绝已删除的旧字段。
- PostgreSQL 迁移后旧人物和声纹内容被确定性保留。

### Web

- 编辑页只显示三个信息分组和最终字段。
- 页面不再出现外在目标、内在欲望、恐惧与底线、角色弧光、剧情功能及结构化声纹
  标签。
- 表达习惯每项只有一个输入。
- 典型台词每项只有情境和台词两个输入。
- 保存请求只携带最终契约，刷新后可以恢复。
- 角色列表卡片改为展示性格内核、核心动机与矛盾和主线关系。

### 文档一致性

- 删除 `CONTEXT.md` 中已经废弃的“角色顺序”术语，避免未来 Agent 上下文重新引用
  已移除概念。

## 完成标准

- 数据库、领域模型、DTO、API 类型和 Web 表单不再包含被删除字段。
- 用户只需填写三个人物文本、一个说话方式、可选习惯和可选典型台词。
- 旧非空角色资料通过迁移进入对应的新字段，不被静默清空。
- Server 和 Web 定向测试、类型检查、构建、格式检查及迁移验证通过。
