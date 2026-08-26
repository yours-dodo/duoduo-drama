import { inject, reactive, type InjectionKey } from 'vue';

import {
  cloneWorldviewEntity,
  createWorldviewEntity,
  createWorldviewKnowledgeGraphSeed,
  getWorldviewEntities,
  getWorldviewEntityReferences,
  type WorldviewEntity,
  type WorldviewEntityType,
  type WorldviewKnowledgeGraphState,
} from './story-worldview-ontology';

type StoryWorldviewProjectState = {
  graph: WorldviewKnowledgeGraphState;
  localEntitySequence: number;
};

export type StoryWorldviewEntityDeleteResult =
  { deleted: true; references: [] } | { deleted: false; references: string[] };

export type StoryWorldviewStateRegistry = {
  getGraph(projectId: string): WorldviewKnowledgeGraphState;
  getEntity(projectId: string, entityId: string): WorldviewEntity | undefined;
  createEntity(
    projectId: string,
    type: WorldviewEntityType,
    groupId: string,
  ): WorldviewEntity;
  saveEntity(projectId: string, entity: WorldviewEntity): boolean;
  deleteEntity(
    projectId: string,
    entityId: string,
  ): StoryWorldviewEntityDeleteResult;
};

export const storyWorldviewStateRegistryKey: InjectionKey<StoryWorldviewStateRegistry> =
  Symbol('story-worldview-state-registry');

export function createStoryWorldviewStateRegistry(): StoryWorldviewStateRegistry {
  const projects = new Map<string, StoryWorldviewProjectState>();

  function getProject(projectId: string): StoryWorldviewProjectState {
    const key = projectId.trim() || 'unknown-project';
    const existing = projects.get(key);
    if (existing) return existing;

    const created = reactive({
      graph: createWorldviewKnowledgeGraphSeed(),
      localEntitySequence: 0,
    }) as StoryWorldviewProjectState;
    projects.set(key, created);
    return created;
  }

  return {
    getGraph(projectId) {
      return getProject(projectId).graph;
    },

    getEntity(projectId, entityId) {
      return getWorldviewEntities(getProject(projectId).graph).find(
        (entity) => entity.id === entityId,
      );
    },

    createEntity(projectId, type, groupId) {
      const project = getProject(projectId);
      const entities = getWorldviewEntities(project.graph);
      const typeCount =
        entities.filter((entity) => entity.type === type).length + 1;
      let id: string;
      do {
        project.localEntitySequence += 1;
        id = `worldview-local-${groupId}-${project.localEntitySequence}`;
      } while (project.graph.nodes.some((node) => node.id === id));

      const entity = createWorldviewEntity(type, id, typeCount);
      project.graph.nodes.push(entity);
      return entity;
    },

    saveEntity(projectId, entity) {
      const graph = getProject(projectId).graph;
      const index = graph.nodes.findIndex(
        (candidate) =>
          candidate.kind === 'entity' && candidate.id === entity.id,
      );
      if (index < 0) return false;
      graph.nodes.splice(index, 1, cloneWorldviewEntity(entity));
      return true;
    },

    deleteEntity(projectId, entityId) {
      const graph = getProject(projectId).graph;
      const references = getWorldviewEntityReferences(entityId, graph);
      if (references.length) return { deleted: false, references };

      const index = graph.nodes.findIndex(
        (candidate) => candidate.kind === 'entity' && candidate.id === entityId,
      );
      if (index < 0) return { deleted: false, references: [] };
      graph.nodes.splice(index, 1);
      return { deleted: true, references: [] };
    },
  };
}

export function useStoryWorldviewStateRegistry(): StoryWorldviewStateRegistry {
  const registry = inject(storyWorldviewStateRegistryKey);
  if (!registry) {
    throw new Error('Story worldview state registry is not available');
  }
  return registry;
}
