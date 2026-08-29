import { describe, expect, it } from 'vitest';

import {
  cloneWorldviewEntity,
  createWorldviewEntity,
  createWorldviewKnowledgeGraphSeed,
  deriveWorldviewFactGraph,
  flattenWorldviewEntityGroups,
  getWorldviewAllowedSourceEntities,
  getWorldviewAllowedTargetEntities,
  getWorldviewEntities,
  getWorldviewEntityReferences,
  getWorldviewFactsForEntity,
  getWorldviewFactStatements,
  getWorldviewPredicateReferences,
  getWorldviewPredicateSchema,
  getWorldviewPredicates,
  getWorldviewSchemaStatements,
  groupWorldviewEntities,
  serializeWorldviewFactContext,
  validateWorldviewEntity,
  validateWorldviewFact,
  validateWorldviewPredicateDefinition,
  type WorldviewFactStatement,
  type WorldviewPredicateDefinition,
} from './story-worldview-ontology';

describe('story worldview knowledge graph', () => {
  it('groups each entity under its matching directory', () => {
    const state = createWorldviewKnowledgeGraphSeed();
    const groups = groupWorldviewEntities(getWorldviewEntities(state));

    expect(
      groups.map((group) => ({
        directory: group.label,
        items: group.entities.map((entity) => entity.name),
      })),
    ).toEqual([
      { directory: '地点', items: ['雾城'] },
      { directory: '组织', items: ['档案管理局'] },
      { directory: '角色', items: ['林遥'] },
      { directory: '规则', items: ['记忆规则'] },
    ]);

    groups.forEach((group) => {
      expect(
        group.entities.every((entity) => entity.type === group.label),
      ).toBe(true);
    });
  });

  it('derives the complete flat entity list from the directories', () => {
    const state = createWorldviewKnowledgeGraphSeed();

    expect(
      flattenWorldviewEntityGroups(
        groupWorldviewEntities(getWorldviewEntities(state)),
      ).map((entity) => entity.id),
    ).toEqual(['fog-city', 'archive-bureau', 'lin-yao', 'memory-law']);
    expect(flattenWorldviewEntityGroups([])).toEqual([]);
  });

  it('creates independent serializable unified graph states', () => {
    const first = createWorldviewKnowledgeGraphSeed();
    const second = createWorldviewKnowledgeGraphSeed();

    getWorldviewEntities(first)[0]!.name = '已修改地点';
    first.statements[0]!.objectId = 'changed-object';

    expect(getWorldviewEntities(second)[0]?.name).toBe('雾城');
    expect(second.statements[0]?.objectId).not.toBe('changed-object');
    expect(() => JSON.stringify(first)).not.toThrow();
  });

  it('preserves type-specific entity fields and validation', () => {
    const state = createWorldviewKnowledgeGraphSeed();
    const entities = getWorldviewEntities(state);
    const location = createWorldviewEntity('地点', 'location-new');
    location.name = '雾城';
    location.attributes.parentLocationId = 'archive-bureau';

    expect(validateWorldviewEntity(location, entities)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name' }),
        expect.objectContaining({ field: 'summary' }),
        expect.objectContaining({ field: 'attributes.locationType' }),
        expect.objectContaining({ field: 'attributes.parentLocationId' }),
      ]),
    );

    const rule = entities.find((entity) => entity.type === '规则')!;
    const clonedRule = cloneWorldviewEntity(rule);
    if (clonedRule.type !== '规则') throw new Error('Expected a rule entity');
    clonedRule.attributes.exceptions.push('新的例外');

    expect(rule.type === '规则' && rule.attributes.exceptions).not.toContain(
      '新的例外',
    );
  });

  it('stores ontology schema and world facts in one graph without conflating them', () => {
    const state = createWorldviewKnowledgeGraphSeed();
    const facts = getWorldviewFactStatements(state);
    const schema = getWorldviewSchemaStatements(state);

    expect(facts).toHaveLength(4);
    expect(facts.every((statement) => statement.kind === 'fact')).toBe(true);
    expect(schema.length).toBeGreaterThan(4);
    expect(schema.every((statement) => statement.kind === 'schema')).toBe(true);
    expect(facts.map((fact) => fact.id)).toEqual([
      'fact-lin-bureau',
      'fact-bureau-city',
      'fact-rule-bureau',
      'fact-lin-rule',
    ]);
  });

  it('resolves predicate domain, range, inverse, scope, and status', () => {
    const state = createWorldviewKnowledgeGraphSeed();
    const schema = getWorldviewPredicateSchema('works-at', state);
    const predicate = getWorldviewPredicates(state).find(
      (candidate) => candidate.id === 'works-at',
    );

    expect(predicate).toMatchObject({
      label: '工作于',
      scope: 'system',
      status: 'active',
    });
    expect(schema).toEqual({
      sourceTypes: ['角色'],
      targetTypes: ['组织'],
      inversePredicateId: 'employs',
    });
  });

  it('uses ontology schema to filter legal sources and targets', () => {
    const state = createWorldviewKnowledgeGraphSeed();

    expect(
      getWorldviewAllowedSourceEntities('works-at', state).map(
        (entity) => entity.name,
      ),
    ).toEqual(['林遥']);
    expect(
      getWorldviewAllowedTargetEntities('works-at', state).map(
        (entity) => entity.name,
      ),
    ).toEqual(['档案管理局']);
  });

  it('validates fact references, schema constraints, duplicates, and predicate status', () => {
    const state = createWorldviewKnowledgeGraphSeed();
    const invalidSource: WorldviewFactStatement = {
      id: 'fact-invalid-source',
      kind: 'fact',
      subjectId: 'fog-city',
      predicateId: 'works-at',
      objectId: 'archive-bureau',
    };

    expect(validateWorldviewFact(invalidSource, state)).toContainEqual(
      expect.objectContaining({ field: 'subjectId' }),
    );

    const duplicate: WorldviewFactStatement = {
      id: 'fact-duplicate',
      kind: 'fact',
      subjectId: 'lin-yao',
      predicateId: 'works-at',
      objectId: 'archive-bureau',
    };
    expect(validateWorldviewFact(duplicate, state)).toContainEqual(
      expect.objectContaining({ field: 'duplicate' }),
    );

    const predicate = getWorldviewPredicates(state).find(
      (candidate) => candidate.id === 'works-at',
    )!;
    predicate.status = 'inactive';
    expect(validateWorldviewFact(duplicate, state)).toContainEqual(
      expect.objectContaining({ field: 'predicateId' }),
    );
  });

  it('filters incoming and outgoing facts while preserving the global default', () => {
    const state = createWorldviewKnowledgeGraphSeed();

    expect(getWorldviewFactsForEntity(null, state)).toHaveLength(4);
    expect(
      getWorldviewFactsForEntity('lin-yao', state).map((fact) => fact.id),
    ).toEqual(['fact-lin-bureau', 'fact-lin-rule']);
    expect(
      getWorldviewFactsForEntity('archive-bureau', state).map(
        (fact) => fact.id,
      ),
    ).toEqual(['fact-lin-bureau', 'fact-bureau-city', 'fact-rule-bureau']);
  });

  it('derives a fact-only graph with isolated entities and no schema nodes', () => {
    const state = createWorldviewKnowledgeGraphSeed();
    state.nodes.push({
      id: 'isolated-character',
      kind: 'entity',
      classId: 'class-character',
      type: '角色',
      name: '无关系角色',
      aliases: [],
      summary: '尚未建立事实关系。',
      description: '',
      attributes: { roleAssetId: 'zhou-yan', worldIdentity: '观察者' },
    });

    const graph = deriveWorldviewFactGraph(state);

    expect(graph.nodes.map((node) => node.id)).toContain('isolated-character');
    expect(graph.edges).toHaveLength(4);
    expect(graph.nodes.every((node) => node.kind === 'entity')).toBe(true);
    expect(graph.edges.every((edge) => edge.statement.kind === 'fact')).toBe(
      true,
    );
    expect(graph.nodes.map((node) => node.id)).not.toContain('class-character');
  });

  it('serializes only facts into stable AI and RAG context', () => {
    const state = createWorldviewKnowledgeGraphSeed();
    const context = serializeWorldviewFactContext(state);

    expect(context).toContain('林遥工作于档案管理局。');
    expect(context).toContain('档案管理局位于雾城。');
    expect(context).toContain('记忆规则约束档案管理局。');
    expect(context).not.toContain('源类型');
    expect(context).not.toContain('对象关系');
  });

  it('validates project predicates while keeping system predicates immutable', () => {
    const state = createWorldviewKnowledgeGraphSeed();
    const projectDefinition: WorldviewPredicateDefinition = {
      predicate: {
        id: 'protects',
        kind: 'predicate',
        usage: 'fact',
        label: '保护',
        scope: 'project',
        status: 'active',
      },
      sourceTypes: ['角色'],
      targetTypes: ['角色'],
      inversePredicateId: null,
    };

    expect(
      validateWorldviewPredicateDefinition(projectDefinition, state),
    ).toEqual([]);

    projectDefinition.predicate.label = '工作于';
    expect(
      validateWorldviewPredicateDefinition(projectDefinition, state),
    ).toContainEqual(expect.objectContaining({ field: 'label' }));

    const systemDefinition: WorldviewPredicateDefinition = {
      ...projectDefinition,
      predicate: {
        ...projectDefinition.predicate,
        id: 'works-at',
        label: '工作于',
        scope: 'system',
      },
    };
    expect(
      validateWorldviewPredicateDefinition(systemDefinition, state),
    ).toContainEqual(expect.objectContaining({ field: 'scope' }));
  });

  it('reports entity and predicate references before destructive changes', () => {
    const state = createWorldviewKnowledgeGraphSeed();

    expect(getWorldviewEntityReferences('fog-city', state)).toContain(
      '事实「位于」',
    );
    expect(getWorldviewEntityReferences('fog-city', state)).toContain(
      '组织「档案管理局」的所在地',
    );
    expect(getWorldviewPredicateReferences('works-at', state)).toEqual([
      '事实「林遥 工作于 档案管理局」',
    ]);
  });
});
