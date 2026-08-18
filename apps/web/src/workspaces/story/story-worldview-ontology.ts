export type WorldviewEntityType = '地点' | '组织' | '角色' | '规则';

export type WorldviewClassId =
  'class-location' | 'class-organization' | 'class-character' | 'class-rule';

export type WorldviewEntityBase<
  TType extends WorldviewEntityType,
  TClassId extends WorldviewClassId,
  TAttributes,
> = {
  id: string;
  kind: 'entity';
  classId: TClassId;
  type: TType;
  name: string;
  aliases: string[];
  summary: string;
  description: string;
  attributes: TAttributes;
};

export type LocationEntity = WorldviewEntityBase<
  '地点',
  'class-location',
  {
    locationType: string;
    parentLocationId: string | null;
    era: string;
    environment: string;
  }
>;

export type OrganizationEntity = WorldviewEntityBase<
  '组织',
  'class-organization',
  {
    purpose: string;
    authority: string;
    locationId: string | null;
  }
>;

export type CharacterEntity = WorldviewEntityBase<
  '角色',
  'class-character',
  {
    roleAssetId: string;
    worldIdentity: string;
  }
>;

export type RuleEntity = WorldviewEntityBase<
  '规则',
  'class-rule',
  {
    scope: string;
    trigger: string;
    effect: string;
    cost: string;
    exceptions: string[];
  }
>;

export type WorldviewEntity =
  LocationEntity | OrganizationEntity | CharacterEntity | RuleEntity;

export type WorldviewClassNode = {
  id: WorldviewClassId;
  kind: 'class';
  label: WorldviewEntityType;
};

export type WorldviewPredicateNode = {
  id: string;
  kind: 'predicate';
  usage: 'schema' | 'fact';
  label: string;
  scope: 'system' | 'project';
  status: 'active' | 'inactive';
};

export type WorldviewNode =
  WorldviewClassNode | WorldviewEntity | WorldviewPredicateNode;

export type WorldviewStatementBase<TKind extends 'schema' | 'fact'> = {
  id: string;
  kind: TKind;
  subjectId: string;
  predicateId: string;
  objectId: string;
};

export type WorldviewSchemaStatement = WorldviewStatementBase<'schema'>;
export type WorldviewFactStatement = WorldviewStatementBase<'fact'>;
export type WorldviewStatement =
  WorldviewSchemaStatement | WorldviewFactStatement;

export type WorldviewKnowledgeGraphState = {
  nodes: WorldviewNode[];
  statements: WorldviewStatement[];
};

export type WorldviewPredicateSchema = {
  sourceTypes: WorldviewEntityType[];
  targetTypes: WorldviewEntityType[];
  inversePredicateId: string | null;
};

export type WorldviewPredicateDefinition = {
  predicate: WorldviewPredicateNode;
  sourceTypes: WorldviewEntityType[];
  targetTypes: WorldviewEntityType[];
  inversePredicateId: string | null;
};

export type WorldviewEntityGroup = {
  id: string;
  label: WorldviewEntityType;
  entities: readonly WorldviewEntity[];
};

export type WorldviewValidationIssue = {
  field: string;
  message: string;
};

export type WorldviewRoleAssetOption = {
  id: string;
  name: string;
  role: string;
};

export type WorldviewFactGraphEdge = {
  id: string;
  statement: WorldviewFactStatement;
  source: WorldviewEntity;
  target: WorldviewEntity;
  predicate: WorldviewPredicateNode;
};

export type WorldviewFactGraph = {
  nodes: WorldviewEntity[];
  edges: WorldviewFactGraphEdge[];
};

const schemaPredicateIds = {
  sourceType: 'schema-source-type',
  targetType: 'schema-target-type',
  inverse: 'schema-inverse',
} as const;

const classIdByEntityType: Record<WorldviewEntityType, WorldviewClassId> = {
  地点: 'class-location',
  组织: 'class-organization',
  角色: 'class-character',
  规则: 'class-rule',
};

const entityTypeByClassId: Record<WorldviewClassId, WorldviewEntityType> = {
  'class-location': '地点',
  'class-organization': '组织',
  'class-character': '角色',
  'class-rule': '规则',
};

export const worldviewRoleAssetOptions: readonly WorldviewRoleAssetOption[] = [
  { id: 'lin-yao', name: '林遥', role: '档案修复师' },
  { id: 'zhou-yan', name: '周砚', role: '调查组旧成员' },
  { id: 'chen-yin', name: '陈音', role: '档案馆管理员' },
  { id: 'shen-qiao', name: '沈乔', role: '城市记忆项目负责人' },
];

export const worldviewEntityDirectories: readonly Omit<
  WorldviewEntityGroup,
  'entities'
>[] = [
  { id: 'locations', label: '地点' },
  { id: 'organizations', label: '组织' },
  { id: 'characters', label: '角色' },
  { id: 'rules', label: '规则' },
];

const classNodes: WorldviewClassNode[] = [
  { id: 'class-location', kind: 'class', label: '地点' },
  { id: 'class-organization', kind: 'class', label: '组织' },
  { id: 'class-character', kind: 'class', label: '角色' },
  { id: 'class-rule', kind: 'class', label: '规则' },
];

const entityNodes: WorldviewEntity[] = [
  {
    id: 'fog-city',
    kind: 'entity',
    classId: 'class-location',
    type: '地点',
    name: '雾城',
    aliases: ['雾都'],
    summary: '故事发生的临海城市，公共记忆由档案系统维持。',
    description:
      '<p>旧城区被高架轨道切成两半，档案馆位于两种生活交界的地方。</p>',
    attributes: {
      locationType: '临海城市',
      parentLocationId: null,
      era: '近未来',
      environment: '潮湿、多雨，旧城区与新城区长期存在空间断层。',
    },
  },
  {
    id: 'archive-bureau',
    kind: 'entity',
    classId: 'class-organization',
    type: '组织',
    name: '档案管理局',
    aliases: ['管理局'],
    summary: '负责保存、修复和授权城市公共档案。',
    description:
      '<p>它掌握城市的公共记忆，并为不同身份分配不同的查看权限。</p>',
    attributes: {
      purpose: '维持雾城对“被记录事实”的共同信任。',
      authority: '公共档案保存、修复、访问授权与事故记录修订。',
      locationId: 'fog-city',
    },
  },
  {
    id: 'lin-yao',
    kind: 'entity',
    classId: 'class-character',
    type: '角色',
    name: '林遥',
    aliases: [],
    summary: '地方档案馆修复师，相信证据胜过记忆。',
    description:
      '<p>她通过修复旧档案追查父亲留下的记录，并逐渐怀疑城市的记忆秩序。</p>',
    attributes: {
      roleAssetId: 'lin-yao',
      worldIdentity: '档案管理局下属地方档案馆的修复师。',
    },
  },
  {
    id: 'memory-law',
    kind: 'entity',
    classId: 'class-rule',
    type: '规则',
    name: '记忆规则',
    aliases: ['记忆归档规则'],
    summary: '未被系统记录的记忆不能直接改变城市事实。',
    description:
      '<p>雾城相信“被记录的事实”才是事实，个人叙述只有进入档案系统后才拥有公共效力。</p>',
    attributes: {
      scope: '雾城公共档案系统及其覆盖的居民身份记录。',
      trigger: '个人记忆试图改变公共记录或城市身份判定时。',
      effect: '系统以已归档记录为准，未归档叙述不产生公共效力。',
      cost: '修改档案会留下时间戳，并改变相关人物的身份权重。',
      exceptions: ['持有原始纸质证据并通过人工复核。'],
    },
  },
];

const predicateNodes: WorldviewPredicateNode[] = [
  {
    id: schemaPredicateIds.sourceType,
    kind: 'predicate',
    usage: 'schema',
    label: '源类型',
    scope: 'system',
    status: 'active',
  },
  {
    id: schemaPredicateIds.targetType,
    kind: 'predicate',
    usage: 'schema',
    label: '目标类型',
    scope: 'system',
    status: 'active',
  },
  {
    id: schemaPredicateIds.inverse,
    kind: 'predicate',
    usage: 'schema',
    label: '反向关系',
    scope: 'system',
    status: 'active',
  },
  {
    id: 'works-at',
    kind: 'predicate',
    usage: 'fact',
    label: '工作于',
    scope: 'system',
    status: 'active',
  },
  {
    id: 'employs',
    kind: 'predicate',
    usage: 'fact',
    label: '雇佣',
    scope: 'system',
    status: 'active',
  },
  {
    id: 'located-in',
    kind: 'predicate',
    usage: 'fact',
    label: '位于',
    scope: 'system',
    status: 'active',
  },
  {
    id: 'constrains',
    kind: 'predicate',
    usage: 'fact',
    label: '约束',
    scope: 'system',
    status: 'active',
  },
  {
    id: 'tries-to-change',
    kind: 'predicate',
    usage: 'fact',
    label: '试图改变',
    scope: 'system',
    status: 'active',
  },
];

const schemaStatements: WorldviewSchemaStatement[] = [
  {
    id: 'schema-works-at-source',
    kind: 'schema',
    subjectId: 'works-at',
    predicateId: schemaPredicateIds.sourceType,
    objectId: 'class-character',
  },
  {
    id: 'schema-works-at-target',
    kind: 'schema',
    subjectId: 'works-at',
    predicateId: schemaPredicateIds.targetType,
    objectId: 'class-organization',
  },
  {
    id: 'schema-works-at-inverse',
    kind: 'schema',
    subjectId: 'works-at',
    predicateId: schemaPredicateIds.inverse,
    objectId: 'employs',
  },
  {
    id: 'schema-employs-source',
    kind: 'schema',
    subjectId: 'employs',
    predicateId: schemaPredicateIds.sourceType,
    objectId: 'class-organization',
  },
  {
    id: 'schema-employs-target',
    kind: 'schema',
    subjectId: 'employs',
    predicateId: schemaPredicateIds.targetType,
    objectId: 'class-character',
  },
  {
    id: 'schema-employs-inverse',
    kind: 'schema',
    subjectId: 'employs',
    predicateId: schemaPredicateIds.inverse,
    objectId: 'works-at',
  },
  {
    id: 'schema-located-in-source',
    kind: 'schema',
    subjectId: 'located-in',
    predicateId: schemaPredicateIds.sourceType,
    objectId: 'class-organization',
  },
  {
    id: 'schema-located-in-target',
    kind: 'schema',
    subjectId: 'located-in',
    predicateId: schemaPredicateIds.targetType,
    objectId: 'class-location',
  },
  {
    id: 'schema-constrains-source',
    kind: 'schema',
    subjectId: 'constrains',
    predicateId: schemaPredicateIds.sourceType,
    objectId: 'class-rule',
  },
  {
    id: 'schema-constrains-target',
    kind: 'schema',
    subjectId: 'constrains',
    predicateId: schemaPredicateIds.targetType,
    objectId: 'class-organization',
  },
  {
    id: 'schema-change-source',
    kind: 'schema',
    subjectId: 'tries-to-change',
    predicateId: schemaPredicateIds.sourceType,
    objectId: 'class-character',
  },
  {
    id: 'schema-change-target',
    kind: 'schema',
    subjectId: 'tries-to-change',
    predicateId: schemaPredicateIds.targetType,
    objectId: 'class-rule',
  },
];

const factStatements: WorldviewFactStatement[] = [
  {
    id: 'fact-lin-bureau',
    kind: 'fact',
    subjectId: 'lin-yao',
    predicateId: 'works-at',
    objectId: 'archive-bureau',
  },
  {
    id: 'fact-bureau-city',
    kind: 'fact',
    subjectId: 'archive-bureau',
    predicateId: 'located-in',
    objectId: 'fog-city',
  },
  {
    id: 'fact-rule-bureau',
    kind: 'fact',
    subjectId: 'memory-law',
    predicateId: 'constrains',
    objectId: 'archive-bureau',
  },
  {
    id: 'fact-lin-rule',
    kind: 'fact',
    subjectId: 'lin-yao',
    predicateId: 'tries-to-change',
    objectId: 'memory-law',
  },
];

const worldviewSeed: WorldviewKnowledgeGraphState = {
  nodes: [...classNodes, ...entityNodes, ...predicateNodes],
  statements: [...schemaStatements, ...factStatements],
};

export function cloneWorldviewEntity(entity: WorldviewEntity): WorldviewEntity {
  const base = { ...entity, aliases: [...entity.aliases] };

  if (entity.type === '规则') {
    return {
      ...base,
      attributes: {
        ...entity.attributes,
        exceptions: [...entity.attributes.exceptions],
      },
    };
  }

  return {
    ...base,
    attributes: { ...entity.attributes },
  } as WorldviewEntity;
}

function cloneWorldviewNode(node: WorldviewNode): WorldviewNode {
  if (node.kind === 'entity') return cloneWorldviewEntity(node);
  return { ...node };
}

export function createWorldviewKnowledgeGraphSeed(): WorldviewKnowledgeGraphState {
  return {
    nodes: worldviewSeed.nodes.map(cloneWorldviewNode),
    statements: worldviewSeed.statements.map((statement) => ({
      ...statement,
    })),
  };
}

export function getWorldviewEntities(
  state: WorldviewKnowledgeGraphState,
): WorldviewEntity[] {
  return state.nodes.filter(
    (node): node is WorldviewEntity => node.kind === 'entity',
  );
}

export function getWorldviewPredicates(
  state: WorldviewKnowledgeGraphState,
  usage: WorldviewPredicateNode['usage'] = 'fact',
): WorldviewPredicateNode[] {
  return state.nodes.filter(
    (node): node is WorldviewPredicateNode =>
      node.kind === 'predicate' && node.usage === usage,
  );
}

export function getWorldviewSchemaStatements(
  state: WorldviewKnowledgeGraphState,
): WorldviewSchemaStatement[] {
  return state.statements.filter(
    (statement): statement is WorldviewSchemaStatement =>
      statement.kind === 'schema',
  );
}

export function getWorldviewFactStatements(
  state: WorldviewKnowledgeGraphState,
): WorldviewFactStatement[] {
  return state.statements.filter(
    (statement): statement is WorldviewFactStatement =>
      statement.kind === 'fact',
  );
}

export function createWorldviewEntity(
  type: WorldviewEntityType,
  id: string,
  index = 1,
): WorldviewEntity {
  const common = {
    id,
    kind: 'entity' as const,
    name: `新${type}${index > 1 ? ` ${index}` : ''}`,
    aliases: [],
    summary: '',
    description: '',
  };

  if (type === '地点') {
    return {
      ...common,
      classId: 'class-location',
      type,
      attributes: {
        locationType: '',
        parentLocationId: null,
        era: '',
        environment: '',
      },
    };
  }

  if (type === '组织') {
    return {
      ...common,
      classId: 'class-organization',
      type,
      attributes: { purpose: '', authority: '', locationId: null },
    };
  }

  if (type === '角色') {
    return {
      ...common,
      classId: 'class-character',
      type,
      attributes: { roleAssetId: '', worldIdentity: '' },
    };
  }

  return {
    ...common,
    classId: 'class-rule',
    type,
    attributes: {
      scope: '',
      trigger: '',
      effect: '',
      cost: '',
      exceptions: [],
    },
  };
}

export function groupWorldviewEntities(
  entities: readonly WorldviewEntity[],
): WorldviewEntityGroup[] {
  return worldviewEntityDirectories.map((directory) => ({
    ...directory,
    entities: entities.filter((entity) => entity.type === directory.label),
  }));
}

export function flattenWorldviewEntityGroups(
  groups: readonly WorldviewEntityGroup[],
): WorldviewEntity[] {
  return groups.flatMap((group) => group.entities);
}

function pushRequiredIssue(
  issues: WorldviewValidationIssue[],
  field: string,
  value: string,
  label: string,
) {
  if (!value.trim()) issues.push({ field, message: `请填写${label}` });
}

function findEntity(
  entities: readonly WorldviewEntity[],
  entityId: string | null,
) {
  if (!entityId) return undefined;
  return entities.find((entity) => entity.id === entityId);
}

export function validateWorldviewEntity(
  entity: WorldviewEntity,
  entities: readonly WorldviewEntity[],
  roleAssets: readonly WorldviewRoleAssetOption[] = worldviewRoleAssetOptions,
): WorldviewValidationIssue[] {
  const issues: WorldviewValidationIssue[] = [];

  pushRequiredIssue(issues, 'name', entity.name, '名称');
  pushRequiredIssue(issues, 'summary', entity.summary, '一句话摘要');

  if (entity.classId !== classIdByEntityType[entity.type]) {
    issues.push({ field: 'classId', message: '实体类别引用无效' });
  }

  if (
    entity.name.trim() &&
    entities.some(
      (candidate) =>
        candidate.id !== entity.id &&
        candidate.type === entity.type &&
        candidate.name.trim() === entity.name.trim(),
    )
  ) {
    issues.push({ field: 'name', message: '同一类型内不能使用重复名称' });
  }

  if (entity.type === '地点') {
    pushRequiredIssue(
      issues,
      'attributes.locationType',
      entity.attributes.locationType,
      '地点类型',
    );
    pushRequiredIssue(issues, 'attributes.era', entity.attributes.era, '时代');
    pushRequiredIssue(
      issues,
      'attributes.environment',
      entity.attributes.environment,
      '环境特征',
    );

    const parent = findEntity(entities, entity.attributes.parentLocationId);
    if (entity.attributes.parentLocationId === entity.id) {
      issues.push({
        field: 'attributes.parentLocationId',
        message: '地点不能以自身作为上级地点',
      });
    } else if (entity.attributes.parentLocationId && parent?.type !== '地点') {
      issues.push({
        field: 'attributes.parentLocationId',
        message: '上级地点引用无效',
      });
    }
  }

  if (entity.type === '组织') {
    pushRequiredIssue(
      issues,
      'attributes.purpose',
      entity.attributes.purpose,
      '组织目标',
    );
    pushRequiredIssue(
      issues,
      'attributes.authority',
      entity.attributes.authority,
      '权力范围',
    );

    const location = findEntity(entities, entity.attributes.locationId);
    if (entity.attributes.locationId && location?.type !== '地点') {
      issues.push({
        field: 'attributes.locationId',
        message: '所在地引用无效',
      });
    }
  }

  if (entity.type === '角色') {
    pushRequiredIssue(
      issues,
      'attributes.roleAssetId',
      entity.attributes.roleAssetId,
      '关联角色资产',
    );
    pushRequiredIssue(
      issues,
      'attributes.worldIdentity',
      entity.attributes.worldIdentity,
      '在世界中的身份',
    );

    if (
      entity.attributes.roleAssetId &&
      !roleAssets.some((role) => role.id === entity.attributes.roleAssetId)
    ) {
      issues.push({
        field: 'attributes.roleAssetId',
        message: '角色资产引用无效',
      });
    }
  }

  if (entity.type === '规则') {
    pushRequiredIssue(
      issues,
      'attributes.scope',
      entity.attributes.scope,
      '适用范围',
    );
    pushRequiredIssue(
      issues,
      'attributes.trigger',
      entity.attributes.trigger,
      '触发条件',
    );
    pushRequiredIssue(
      issues,
      'attributes.effect',
      entity.attributes.effect,
      '产生效果',
    );
    pushRequiredIssue(
      issues,
      'attributes.cost',
      entity.attributes.cost,
      '代价',
    );
  }

  return issues;
}

function classIdsToTypes(classIds: readonly string[]): WorldviewEntityType[] {
  return classIds
    .map((classId) => entityTypeByClassId[classId as WorldviewClassId])
    .filter((type): type is WorldviewEntityType => Boolean(type));
}

export function getWorldviewPredicateSchema(
  predicateId: string,
  state: WorldviewKnowledgeGraphState,
): WorldviewPredicateSchema {
  const statements = getWorldviewSchemaStatements(state).filter(
    (statement) => statement.subjectId === predicateId,
  );

  return {
    sourceTypes: classIdsToTypes(
      statements
        .filter(
          (statement) =>
            statement.predicateId === schemaPredicateIds.sourceType,
        )
        .map((statement) => statement.objectId),
    ),
    targetTypes: classIdsToTypes(
      statements
        .filter(
          (statement) =>
            statement.predicateId === schemaPredicateIds.targetType,
        )
        .map((statement) => statement.objectId),
    ),
    inversePredicateId:
      statements.find(
        (statement) => statement.predicateId === schemaPredicateIds.inverse,
      )?.objectId ?? null,
  };
}

export function getWorldviewPredicateDefinitions(
  state: WorldviewKnowledgeGraphState,
): WorldviewPredicateDefinition[] {
  return getWorldviewPredicates(state).map((predicate) => ({
    predicate,
    ...getWorldviewPredicateSchema(predicate.id, state),
  }));
}

export function getWorldviewAllowedSourceEntities(
  predicateId: string,
  state: WorldviewKnowledgeGraphState,
): WorldviewEntity[] {
  const schema = getWorldviewPredicateSchema(predicateId, state);
  const entities = getWorldviewEntities(state);
  if (!schema.sourceTypes.length) return entities;
  return entities.filter((entity) => schema.sourceTypes.includes(entity.type));
}

export function getWorldviewAllowedTargetEntities(
  predicateId: string,
  state: WorldviewKnowledgeGraphState,
): WorldviewEntity[] {
  const schema = getWorldviewPredicateSchema(predicateId, state);
  const entities = getWorldviewEntities(state);
  if (!schema.targetTypes.length) return entities;
  return entities.filter((entity) => schema.targetTypes.includes(entity.type));
}

export function validateWorldviewFact(
  fact: WorldviewFactStatement,
  state: WorldviewKnowledgeGraphState,
): WorldviewValidationIssue[] {
  const issues: WorldviewValidationIssue[] = [];
  const entities = getWorldviewEntities(state);
  const subject = findEntity(entities, fact.subjectId);
  const object = findEntity(entities, fact.objectId);
  const predicate = getWorldviewPredicates(state).find(
    (candidate) => candidate.id === fact.predicateId,
  );

  if (!subject) issues.push({ field: 'subjectId', message: '源实体引用无效' });
  if (!object) issues.push({ field: 'objectId', message: '目标实体引用无效' });
  if (!predicate) {
    issues.push({ field: 'predicateId', message: '关系类型引用无效' });
  } else if (predicate.status !== 'active') {
    issues.push({ field: 'predicateId', message: '关系类型已停用' });
  }

  if (subject && object && subject.id === object.id) {
    issues.push({ field: 'objectId', message: '源实体和目标实体不能相同' });
  }

  const schema = getWorldviewPredicateSchema(fact.predicateId, state);
  if (
    subject &&
    schema.sourceTypes.length &&
    !schema.sourceTypes.includes(subject.type)
  ) {
    issues.push({
      field: 'subjectId',
      message: '源实体类型不符合 Ontology 约束',
    });
  }
  if (
    object &&
    schema.targetTypes.length &&
    !schema.targetTypes.includes(object.type)
  ) {
    issues.push({
      field: 'objectId',
      message: '目标实体类型不符合 Ontology 约束',
    });
  }

  if (
    getWorldviewFactStatements(state).some(
      (candidate) =>
        candidate.id !== fact.id &&
        candidate.subjectId === fact.subjectId &&
        candidate.predicateId === fact.predicateId &&
        candidate.objectId === fact.objectId,
    )
  ) {
    issues.push({ field: 'duplicate', message: '相同事实已经存在' });
  }

  return issues;
}

export function getWorldviewFactsForEntity(
  entityId: string | null,
  state: WorldviewKnowledgeGraphState,
): WorldviewFactStatement[] {
  const facts = getWorldviewFactStatements(state);
  if (!entityId) return facts;
  return facts.filter(
    (fact) => fact.subjectId === entityId || fact.objectId === entityId,
  );
}

export function deriveWorldviewFactGraph(
  state: WorldviewKnowledgeGraphState,
): WorldviewFactGraph {
  const nodes = getWorldviewEntities(state);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const predicateById = new Map(
    getWorldviewPredicates(state).map((predicate) => [predicate.id, predicate]),
  );
  const edges = getWorldviewFactStatements(state).flatMap((statement) => {
    const source = nodeById.get(statement.subjectId);
    const target = nodeById.get(statement.objectId);
    const predicate = predicateById.get(statement.predicateId);
    if (!source || !target || !predicate) return [];
    return [
      { id: statement.id, statement, source, target, predicate },
    ] satisfies WorldviewFactGraphEdge[];
  });

  return { nodes, edges };
}

export function serializeWorldviewFactContext(
  state: WorldviewKnowledgeGraphState,
): string {
  const graph = deriveWorldviewFactGraph(state);
  return graph.edges
    .map(
      (edge) =>
        `${edge.source.name}${edge.predicate.label}${edge.target.name}。`,
    )
    .join('\n');
}

export function validateWorldviewPredicateDefinition(
  definition: WorldviewPredicateDefinition,
  state: WorldviewKnowledgeGraphState,
): WorldviewValidationIssue[] {
  const issues: WorldviewValidationIssue[] = [];
  pushRequiredIssue(
    issues,
    'label',
    definition.predicate.label,
    '关系类型名称',
  );

  if (definition.predicate.scope === 'system') {
    issues.push({ field: 'scope', message: '系统核心关系类型只读' });
  }
  if (definition.predicate.usage !== 'fact') {
    issues.push({ field: 'usage', message: '只能创建事实关系类型' });
  }
  if (!definition.sourceTypes.length) {
    issues.push({ field: 'sourceTypes', message: '请选择允许的源类型' });
  }
  if (!definition.targetTypes.length) {
    issues.push({ field: 'targetTypes', message: '请选择允许的目标类型' });
  }
  if (
    definition.predicate.label.trim() &&
    getWorldviewPredicates(state).some(
      (candidate) =>
        candidate.id !== definition.predicate.id &&
        candidate.label.trim() === definition.predicate.label.trim(),
    )
  ) {
    issues.push({ field: 'label', message: '关系类型名称不能重复' });
  }
  if (
    definition.inversePredicateId &&
    !getWorldviewPredicates(state).some(
      (predicate) => predicate.id === definition.inversePredicateId,
    )
  ) {
    issues.push({ field: 'inversePredicateId', message: '反向关系引用无效' });
  }

  return issues;
}

export function createWorldviewPredicateSchemaStatements(
  definition: WorldviewPredicateDefinition,
): WorldviewSchemaStatement[] {
  const statements: WorldviewSchemaStatement[] = [];

  definition.sourceTypes.forEach((type) => {
    statements.push({
      id: `schema-${definition.predicate.id}-source-${classIdByEntityType[type]}`,
      kind: 'schema',
      subjectId: definition.predicate.id,
      predicateId: schemaPredicateIds.sourceType,
      objectId: classIdByEntityType[type],
    });
  });
  definition.targetTypes.forEach((type) => {
    statements.push({
      id: `schema-${definition.predicate.id}-target-${classIdByEntityType[type]}`,
      kind: 'schema',
      subjectId: definition.predicate.id,
      predicateId: schemaPredicateIds.targetType,
      objectId: classIdByEntityType[type],
    });
  });
  if (definition.inversePredicateId) {
    statements.push({
      id: `schema-${definition.predicate.id}-inverse`,
      kind: 'schema',
      subjectId: definition.predicate.id,
      predicateId: schemaPredicateIds.inverse,
      objectId: definition.inversePredicateId,
    });
  }

  return statements;
}

export function getWorldviewEntityReferences(
  entityId: string,
  state: WorldviewKnowledgeGraphState,
): string[] {
  const predicateById = new Map(
    getWorldviewPredicates(state).map((predicate) => [predicate.id, predicate]),
  );
  const references = getWorldviewFactStatements(state)
    .filter((fact) => fact.subjectId === entityId || fact.objectId === entityId)
    .map(
      (fact) =>
        `事实「${predicateById.get(fact.predicateId)?.label ?? '未知关系'}」`,
    );

  getWorldviewEntities(state).forEach((entity) => {
    if (
      entity.type === '地点' &&
      entity.attributes.parentLocationId === entityId
    ) {
      references.push(`地点「${entity.name}」的上级地点`);
    }
    if (entity.type === '组织' && entity.attributes.locationId === entityId) {
      references.push(`组织「${entity.name}」的所在地`);
    }
  });

  return references;
}

export function getWorldviewPredicateReferences(
  predicateId: string,
  state: WorldviewKnowledgeGraphState,
): string[] {
  const entityById = new Map(
    getWorldviewEntities(state).map((entity) => [entity.id, entity]),
  );
  const predicate = getWorldviewPredicates(state).find(
    (candidate) => candidate.id === predicateId,
  );

  return getWorldviewFactStatements(state)
    .filter((fact) => fact.predicateId === predicateId)
    .map(
      (fact) =>
        `事实「${entityById.get(fact.subjectId)?.name ?? '未知实体'} ${predicate?.label ?? '未知关系'} ${entityById.get(fact.objectId)?.name ?? '未知实体'}」`,
    );
}
