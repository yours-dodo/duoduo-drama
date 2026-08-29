import { StoryOutlineContentInvalidError } from './story-errors.js';

const OUTLINE_VIEWS = new Set([
  'timeline-horizontal',
  'timeline-vertical',
  'timeline-fishbone',
  'organization-logic',
  'organization-mindmap',
]);
const CANVAS_NODE_TYPES = new Set([
  'beat',
  'event',
  'foreshadow',
  'mystery',
  'storyline',
  'character',
  'conflict',
  'chapter',
]);
const REFERENCE_TYPES = new Set([
  'event',
  'foreshadow',
  'mystery',
  'storyline',
  'role',
  'worldview',
]);

export function validateStoryOutlineContent(content: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new StoryOutlineContentInvalidError();
  }
  if (!isNarrativeDocumentV1(parsed) && !isNarrativeDocumentV2(parsed)) {
    throw new StoryOutlineContentInvalidError();
  }
}

function isNarrativeDocumentV1(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 'narrative-planning.v1' &&
    typeof value.rootStoryId === 'string' &&
    isStory(value.story) &&
    isEntityArray(value.arcs, 'arc') &&
    isEntityArray(value.chapters, 'chapter') &&
    isEntityArray(value.beats, 'beat') &&
    isEntityArray(value.assets)
  );
}

function isNarrativeDocumentV2(value: unknown): boolean {
  if (!isRecord(value) || value.schemaVersion !== 'narrative-planning.v2') {
    return false;
  }
  if (
    typeof value.rootStoryId !== 'string' ||
    !isStory(value.story) ||
    !isArcArray(value.arcs) ||
    !isChapterArray(value.chapters) ||
    !isRecord(value.canvases) ||
    (value.updatedAt !== undefined && typeof value.updatedAt !== 'string')
  ) {
    return false;
  }

  const story = value.story;
  const arcs = value.arcs;
  const chapters = value.chapters;
  const structuralIds = [
    story.id,
    ...arcs.map((arc) => arc.id),
    ...chapters.map((chapter) => chapter.id),
  ];
  if (
    value.rootStoryId !== story.id ||
    !hasUniqueNonEmptyStrings(structuralIds) ||
    !sameStrings(
      story.arcIds,
      arcs.map((arc) => arc.id),
    )
  ) {
    return false;
  }

  const arcIds = new Set(arcs.map((arc) => arc.id));
  for (const arc of arcs) {
    const indexedChapterIds = chapters
      .filter((chapter) => chapter.arcId === arc.id)
      .map((chapter) => chapter.id);
    if (!sameStrings(arc.chapterIds, indexedChapterIds)) return false;
  }
  if (chapters.some((chapter) => !arcIds.has(chapter.arcId))) return false;

  const ownerIds = new Set(structuralIds);
  const canvasOwnerIds = Object.keys(value.canvases);
  if (
    canvasOwnerIds.length !== ownerIds.size ||
    canvasOwnerIds.some((ownerId) => !ownerIds.has(ownerId))
  ) {
    return false;
  }

  const allNodeIds = new Set<string>();
  const chapterBeatIds = new Map<string, string[]>(
    chapters.map((chapter) => [chapter.id, chapter.beatIds as string[]]),
  );
  for (const ownerId of structuralIds) {
    const canvas = value.canvases[ownerId];
    if (!isCanvas(canvas)) return false;
    const nodes = canvas.nodes.filter(isCanvasNode);
    if (nodes.length !== canvas.nodes.length) return false;
    const localNodeIds = new Set<string>();
    for (const node of nodes) {
      if (
        ownerIds.has(node.id) ||
        allNodeIds.has(node.id) ||
        (node.type === 'beat' && node.chapterId !== ownerId)
      ) {
        return false;
      }
      localNodeIds.add(node.id);
      allNodeIds.add(node.id);
    }
    const localEndpoints = new Set([ownerId, ...localNodeIds]);
    if (
      nodes.some(
        (node) =>
          node.parentId !== undefined && !localEndpoints.has(node.parentId),
      ) ||
      canvas.edges.some(
        (edge) =>
          !isCanvasEdge(edge) ||
          !localEndpoints.has(edge.source) ||
          !localEndpoints.has(edge.target),
      ) ||
      canvas.references.some(
        (reference) =>
          !isCanvasReference(reference) ||
          (reference.parentId !== undefined &&
            !localEndpoints.has(reference.parentId)),
      ) ||
      !isPositionsByView(canvas.positionsByView, localEndpoints)
    ) {
      return false;
    }

    const expectedBeatIds = chapterBeatIds.get(ownerId);
    if (expectedBeatIds !== undefined) {
      const actualBeatIds = nodes
        .filter((node) => node.type === 'beat')
        .map((node) => node.id);
      if (!sameStrings(expectedBeatIds, actualBeatIds)) return false;
    }
  }

  return true;
}

function isStory(value: unknown): value is {
  id: string;
  type: 'story';
  title: string;
  summary: string;
  arcIds: string[];
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    value.type === 'story' &&
    typeof value.title === 'string' &&
    typeof value.summary === 'string' &&
    isStringArray(value.arcIds)
  );
}

function isArcArray(value: unknown): value is Array<{
  id: string;
  type: 'arc';
  title: string;
  summary: string;
  order: number;
  chapterIds: string[];
}> {
  return (
    Array.isArray(value) &&
    value.every(
      (arc) =>
        isRecord(arc) &&
        isNonEmptyString(arc.id) &&
        arc.type === 'arc' &&
        typeof arc.title === 'string' &&
        typeof arc.summary === 'string' &&
        Number.isFinite(arc.order) &&
        isStringArray(arc.chapterIds) &&
        hasUniqueNonEmptyStrings(arc.chapterIds),
    )
  );
}

function isChapterArray(value: unknown): value is Array<{
  id: string;
  type: 'chapter';
  title: string;
  summary: string;
  order: number;
  arcId: string;
  goals: string[];
  openingState: string;
  beatIds: string[];
  informationRelease: Record<string, unknown>;
  stateDelta: unknown[];
  referenceIds: string[];
}> {
  return (
    Array.isArray(value) &&
    value.every(
      (chapter) =>
        isRecord(chapter) &&
        isNonEmptyString(chapter.id) &&
        chapter.type === 'chapter' &&
        typeof chapter.title === 'string' &&
        typeof chapter.summary === 'string' &&
        Number.isFinite(chapter.order) &&
        isNonEmptyString(chapter.arcId) &&
        isStringArray(chapter.goals) &&
        typeof chapter.openingState === 'string' &&
        isStringArray(chapter.beatIds) &&
        hasUniqueNonEmptyStrings(chapter.beatIds) &&
        isInformationRelease(chapter.informationRelease) &&
        Array.isArray(chapter.stateDelta) &&
        chapter.stateDelta.every(isStateDelta) &&
        isStringArray(chapter.referenceIds),
    )
  );
}

function isCanvas(value: unknown): value is {
  nodes: Record<string, unknown>[];
  edges: unknown[];
  references: unknown[];
  positionsByView: unknown;
} {
  return (
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    Array.isArray(value.references) &&
    isRecord(value.positionsByView)
  );
}

function isCanvasNode(value: Record<string, unknown>): value is {
  id: string;
  type: string;
  title: string;
  summary: string;
  order: number;
  parentId?: string;
  chapterId?: string;
  referenceIds?: string[];
} {
  return (
    isNonEmptyString(value.id) &&
    typeof value.type === 'string' &&
    CANVAS_NODE_TYPES.has(value.type) &&
    typeof value.title === 'string' &&
    typeof value.summary === 'string' &&
    Number.isFinite(value.order) &&
    (value.parentId === undefined || isNonEmptyString(value.parentId)) &&
    (value.lane === undefined || typeof value.lane === 'string') &&
    (value.chapterId === undefined || isNonEmptyString(value.chapterId)) &&
    (value.type === 'beat'
      ? isStringArray(value.referenceIds)
      : value.referenceIds === undefined ||
        isStringArray(value.referenceIds)) &&
    (value.refId === undefined || isNonEmptyString(value.refId)) &&
    (value.relation === undefined || typeof value.relation === 'string') &&
    (value.legacy === undefined || typeof value.legacy === 'boolean')
  );
}

function isCanvasEdge(value: unknown): value is {
  id: string;
  source: string;
  target: string;
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.source) &&
    isNonEmptyString(value.target) &&
    (value.label === undefined || typeof value.label === 'string') &&
    (value.kind === undefined ||
      value.kind === 'sequence' ||
      value.kind === 'relation')
  );
}

function isCanvasReference(value: unknown): value is {
  parentId?: string;
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.type === 'string' &&
    REFERENCE_TYPES.has(value.type) &&
    isNonEmptyString(value.refId) &&
    typeof value.label === 'string' &&
    (value.parentId === undefined || isNonEmptyString(value.parentId)) &&
    (value.relation === undefined || typeof value.relation === 'string') &&
    (value.legacy === undefined || typeof value.legacy === 'boolean')
  );
}

function isPositionsByView(value: unknown, localNodeIds: Set<string>): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([view, positions]) =>
      OUTLINE_VIEWS.has(view) &&
      isRecord(positions) &&
      Object.entries(positions).every(
        ([nodeId, position]) =>
          localNodeIds.has(nodeId) &&
          isRecord(position) &&
          Number.isFinite(position.x) &&
          Number.isFinite(position.y),
      ),
  );
}

function isInformationRelease(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringArray(value.readerKnows) &&
    isStringArray(value.characterKnows) &&
    isStringArray(value.mustNotReveal)
  );
}

function isStateDelta(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.targetRefId) &&
    typeof value.field === 'string' &&
    (value.from === undefined || typeof value.from === 'string') &&
    (value.to === undefined || typeof value.to === 'string') &&
    (value.note === undefined || typeof value.note === 'string')
  );
}

function isEntityArray(value: unknown, type?: string): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        (type === undefined || item.type === type),
    )
  );
}

function sameStrings(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function hasUniqueNonEmptyStrings(values: string[]): boolean {
  return (
    values.every(isNonEmptyString) && new Set(values).size === values.length
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
