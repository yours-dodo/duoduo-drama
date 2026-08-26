import type { OutlineDocument, OutlineNode } from './story-outline-layout';

export const NARRATIVE_DOCUMENT_SCHEMA_VERSION =
  'narrative-planning.v1' as const;

export type NarrativeEntityType = 'story' | 'arc' | 'chapter' | 'beat';
export const NARRATIVE_CANVAS_ASSET_TYPES = [
  'event',
  'foreshadow',
  'mystery',
  'storyline',
] as const;
export type NarrativeCanvasAssetType =
  (typeof NARRATIVE_CANVAS_ASSET_TYPES)[number];
export const NARRATIVE_CANVAS_ASSET_LABELS: Record<
  NarrativeCanvasAssetType,
  string
> = {
  event: '事件',
  foreshadow: '伏笔',
  mystery: '谜团',
  storyline: '故事线',
};
export type NarrativeAssetType =
  NarrativeCanvasAssetType | 'role' | 'worldview';

export interface NarrativeStateDelta {
  targetRefId: string;
  field: string;
  from?: string;
  to?: string;
  note?: string;
}

export interface NarrativeAssetReference {
  id: string;
  type: NarrativeAssetType;
  refId: string;
  label: string;
  parentId?: string;
  relation?: string;
  legacy?: boolean;
}

export interface NarrativeStory {
  id: string;
  type: 'story';
  title: string;
  summary: string;
  arcIds: string[];
}

export interface NarrativeArc {
  id: string;
  type: 'arc';
  title: string;
  summary: string;
  order: number;
  chapterIds: string[];
}

export interface NarrativeChapter {
  id: string;
  type: 'chapter';
  title: string;
  summary: string;
  order: number;
  arcId: string;
  goals: string[];
  openingState: string;
  beatIds: string[];
  informationRelease: {
    readerKnows: string[];
    characterKnows: string[];
    mustNotReveal: string[];
  };
  stateDelta: NarrativeStateDelta[];
  referenceIds: string[];
}

export interface NarrativeBeat {
  id: string;
  type: 'beat';
  title: string;
  summary: string;
  order: number;
  chapterId: string;
  referenceIds: string[];
}

export interface NarrativeDocument {
  schemaVersion: typeof NARRATIVE_DOCUMENT_SCHEMA_VERSION;
  rootStoryId: string;
  story: NarrativeStory;
  arcs: NarrativeArc[];
  chapters: NarrativeChapter[];
  beats: NarrativeBeat[];
  assets: NarrativeAssetReference[];
  updatedAt?: string;
}

export interface NarrativeDocumentParseResult {
  document: NarrativeDocument;
  migrated: boolean;
  source: 'narrative-json' | 'legacy-outline' | 'empty';
}

export type NarrativeArcRemovalReason = 'arc-not-found' | 'last-arc';

export interface NarrativeArcRemovalResult {
  document: NarrativeDocument;
  removed: boolean;
  targetArcId: string | null;
  migratedChapterIds: string[];
  reason?: NarrativeArcRemovalReason;
}

export type NarrativeChapterRemovalReason =
  'chapter-not-found' | 'parent-arc-not-found';

export interface NarrativeChapterRemovalResult {
  document: NarrativeDocument;
  removed: boolean;
  parentArcId: string | null;
  removedBeatIds: string[];
  reason?: NarrativeChapterRemovalReason;
}

export function createNarrativeDocument(input: {
  storyId?: string;
  title: string;
  summary?: string;
}): NarrativeDocument {
  const storyId = input.storyId ?? createNarrativeId('story');
  const arcId = createNarrativeId('arc');
  const chapterId = createNarrativeId('chapter');
  return {
    schemaVersion: NARRATIVE_DOCUMENT_SCHEMA_VERSION,
    rootStoryId: storyId,
    story: {
      id: storyId,
      type: 'story',
      title: input.title.trim() || '未命名故事',
      summary: input.summary?.trim() ?? '',
      arcIds: [arcId],
    },
    arcs: [
      {
        id: arcId,
        type: 'arc',
        title: '第一幕',
        summary: '',
        order: 0,
        chapterIds: [chapterId],
      },
    ],
    chapters: [
      {
        id: chapterId,
        type: 'chapter',
        title: '第一章',
        summary: '',
        order: 0,
        arcId,
        goals: [],
        openingState: '',
        beatIds: [],
        informationRelease: {
          readerKnows: [],
          characterKnows: [],
          mustNotReveal: [],
        },
        stateDelta: [],
        referenceIds: [],
      },
    ],
    beats: [],
    assets: [],
  };
}

export function parseNarrativeDocument(
  content: string | null | undefined,
  fallback: { title: string; summary?: string },
): NarrativeDocumentParseResult {
  if (!content?.trim()) {
    return {
      document: createNarrativeDocument(fallback),
      migrated: false,
      source: 'empty',
    };
  }

  try {
    const value: unknown = JSON.parse(content);
    if (isNarrativeDocument(value)) {
      return {
        document: normalizeNarrativeDocument(value),
        migrated: false,
        source: 'narrative-json',
      };
    }
    if (isLegacyOutlineDocument(value)) {
      return {
        document: migrateLegacyOutline(value, fallback),
        migrated: true,
        source: 'legacy-outline',
      };
    }
  } catch {
    // Old markdown/text artifacts are preserved by the artifact system. They
    // are intentionally represented by a fresh planning document until an
    // explicit importer is selected.
  }

  return {
    document: createNarrativeDocument(fallback),
    migrated: true,
    source: 'empty',
  };
}

export function normalizeNarrativeDocument(
  value: NarrativeDocument,
): NarrativeDocument {
  const story = value.story;
  const arcs = value.arcs
    .map((arc, index) => ({
      ...arc,
      order: Number.isFinite(arc.order) ? arc.order : index,
      chapterIds: [...arc.chapterIds],
    }))
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    );
  const chapters = value.chapters
    .map((chapter, index) => ({
      ...chapter,
      order: Number.isFinite(chapter.order) ? chapter.order : index,
      goals: [...chapter.goals],
      beatIds: [...chapter.beatIds],
      referenceIds: [...chapter.referenceIds],
      informationRelease: {
        readerKnows: [...chapter.informationRelease.readerKnows],
        characterKnows: [...chapter.informationRelease.characterKnows],
        mustNotReveal: [...chapter.informationRelease.mustNotReveal],
      },
      stateDelta: chapter.stateDelta.map((delta) => ({ ...delta })),
    }))
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    );
  const beats = value.beats
    .map((beat, index) => ({
      ...beat,
      order: Number.isFinite(beat.order) ? beat.order : index,
      referenceIds: [...beat.referenceIds],
    }))
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    );

  const chaptersByArc = new Map<string, NarrativeChapter[]>();
  chapters.forEach((chapter) => {
    const siblings = chaptersByArc.get(chapter.arcId) ?? [];
    siblings.push(chapter);
    chaptersByArc.set(chapter.arcId, siblings);
  });
  const beatsByChapter = new Map<string, NarrativeBeat[]>();
  beats.forEach((beat) => {
    const siblings = beatsByChapter.get(beat.chapterId) ?? [];
    siblings.push(beat);
    beatsByChapter.set(beat.chapterId, siblings);
  });
  chapters.forEach((chapter) => {
    chapter.beatIds = (beatsByChapter.get(chapter.id) ?? []).map(
      (beat) => beat.id,
    );
  });
  arcs.forEach((arc) => {
    arc.chapterIds = (chaptersByArc.get(arc.id) ?? []).map(
      (chapter) => chapter.id,
    );
  });

  return {
    ...value,
    schemaVersion: NARRATIVE_DOCUMENT_SCHEMA_VERSION,
    rootStoryId: story.id,
    story: {
      ...story,
      arcIds: arcs.map((arc) => arc.id),
    },
    arcs,
    chapters,
    beats,
    assets: value.assets.map((asset) => ({ ...asset })),
  };
}

export function removeNarrativeArc(
  document: NarrativeDocument,
  arcId: string,
): NarrativeArcRemovalResult {
  const arcs = [...document.arcs].sort(compareNarrativeOrder);
  const arcIndex = arcs.findIndex((arc) => arc.id === arcId);
  if (arcIndex < 0) {
    return {
      document,
      removed: false,
      targetArcId: null,
      migratedChapterIds: [],
      reason: 'arc-not-found',
    };
  }
  if (arcs.length === 1) {
    return {
      document,
      removed: false,
      targetArcId: null,
      migratedChapterIds: [],
      reason: 'last-arc',
    };
  }

  const targetArc = arcs[arcIndex > 0 ? arcIndex - 1 : arcIndex + 1]!;
  const targetChapters = document.chapters
    .filter((chapter) => chapter.arcId === targetArc.id)
    .sort(compareNarrativeOrder);
  const migratedChapters = document.chapters
    .filter((chapter) => chapter.arcId === arcId)
    .sort(compareNarrativeOrder);
  const targetChapterOrder = new Map(
    [...targetChapters, ...migratedChapters].map((chapter, index) => [
      chapter.id,
      index,
    ]),
  );
  const chapters = document.chapters.map((chapter) => {
    const order = targetChapterOrder.get(chapter.id);
    return order === undefined
      ? chapter
      : { ...chapter, arcId: targetArc.id, order };
  });
  const remainingArcs = arcs
    .filter((arc) => arc.id !== arcId)
    .map((arc, order) => ({ ...arc, order }));

  return {
    document: normalizeNarrativeDocument({
      ...document,
      arcs: remainingArcs,
      chapters,
    }),
    removed: true,
    targetArcId: targetArc.id,
    migratedChapterIds: migratedChapters.map((chapter) => chapter.id),
  };
}

export function removeNarrativeChapter(
  document: NarrativeDocument,
  chapterId: string,
): NarrativeChapterRemovalResult {
  const chapter = document.chapters.find(
    (candidate) => candidate.id === chapterId,
  );
  if (!chapter) {
    return {
      document,
      removed: false,
      parentArcId: null,
      removedBeatIds: [],
      reason: 'chapter-not-found',
    };
  }
  if (!document.arcs.some((arc) => arc.id === chapter.arcId)) {
    return {
      document,
      removed: false,
      parentArcId: null,
      removedBeatIds: [],
      reason: 'parent-arc-not-found',
    };
  }

  const removedBeatIds = document.beats
    .filter((beat) => beat.chapterId === chapterId)
    .map((beat) => beat.id);
  const removedBeatIdSet = new Set(removedBeatIds);
  const remainingChapters = document.chapters.filter(
    (candidate) => candidate.id !== chapterId,
  );
  const siblingOrder = new Map(
    remainingChapters
      .filter((candidate) => candidate.arcId === chapter.arcId)
      .sort(compareNarrativeOrder)
      .map((candidate, order) => [candidate.id, order]),
  );
  const chapters = remainingChapters.map((candidate) => {
    const order = siblingOrder.get(candidate.id);
    return order === undefined ? candidate : { ...candidate, order };
  });
  const beats = document.beats.filter((beat) => !removedBeatIdSet.has(beat.id));

  return {
    document: normalizeNarrativeDocument({
      ...document,
      chapters,
      beats,
    }),
    removed: true,
    parentArcId: chapter.arcId,
    removedBeatIds,
  };
}

export function narrativeDocumentToOutline(
  document: NarrativeDocument,
): OutlineDocument {
  const structuralNodeIds = new Set([
    document.story.id,
    ...document.arcs.map((arc) => arc.id),
    ...document.chapters.map((chapter) => chapter.id),
    ...document.beats.map((beat) => beat.id),
  ]);
  const nodes: OutlineNode[] = [
    {
      id: document.story.id,
      title: document.story.title,
      summary: document.story.summary,
      type: 'chapter',
      lane: '主线',
      order: 0,
    },
  ];
  const edges: OutlineDocument['edges'] = [];

  document.arcs.forEach((arc) => {
    nodes.push({
      id: arc.id,
      title: arc.title,
      summary: arc.summary,
      type: 'chapter',
      parentId: document.story.id,
      lane: '主线',
      order: arc.order + 0.1,
    });
    edges.push({
      id: `narrative-parent-${document.story.id}-${arc.id}`,
      source: document.story.id,
      target: arc.id,
      kind: 'sequence',
    });
  });

  document.chapters.forEach((chapter) => {
    nodes.push({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary,
      type: 'chapter',
      parentId: chapter.arcId,
      lane: '主线',
      order: chapter.order + 1,
    });
    edges.push({
      id: `narrative-parent-${chapter.arcId}-${chapter.id}`,
      source: chapter.arcId,
      target: chapter.id,
      kind: 'sequence',
    });
  });

  document.beats.forEach((beat) => {
    nodes.push({
      id: beat.id,
      title: beat.title,
      summary: beat.summary,
      type: 'event',
      parentId: beat.chapterId,
      lane: 'Beat',
      order: beat.order + 2,
    });
    edges.push({
      id: `narrative-parent-${beat.chapterId}-${beat.id}`,
      source: beat.chapterId,
      target: beat.id,
      kind: 'sequence',
    });
  });

  document.assets.forEach((asset, assetIndex) => {
    if (!isNarrativeCanvasAssetType(asset.type)) return;
    const parentId =
      asset.parentId && structuralNodeIds.has(asset.parentId)
        ? asset.parentId
        : document.story.id;

    nodes.push({
      id: asset.id,
      title: asset.label,
      summary: asset.relation ?? '',
      type: asset.type,
      parentId,
      lane: '剧情资产',
      order:
        document.arcs.length +
        document.chapters.length +
        document.beats.length +
        assetIndex +
        10,
    });
    edges.push({
      id: `narrative-asset-${parentId}-${asset.id}`,
      source: parentId,
      target: asset.id,
      kind: 'relation',
      label: NARRATIVE_CANVAS_ASSET_LABELS[asset.type],
    });
  });

  return { nodes, edges };
}

export function isNarrativeCanvasAssetType(
  type: unknown,
): type is NarrativeCanvasAssetType {
  return NARRATIVE_CANVAS_ASSET_TYPES.some((candidate) => candidate === type);
}

function migrateLegacyOutline(
  legacy: OutlineDocument,
  fallback: { title: string; summary?: string },
): NarrativeDocument {
  const root =
    legacy.nodes.find((node) => !node.parentId) ?? legacy.nodes[0] ?? null;
  const document = createNarrativeDocument({
    storyId: root?.id,
    title: root?.title ?? fallback.title,
    summary: root?.summary ?? fallback.summary,
  });
  document.arcs = [];
  document.chapters = [];
  document.beats = [];
  document.assets = [];

  const children = new Map<string | undefined, OutlineNode[]>();
  legacy.nodes.forEach((node) => {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  });
  children.forEach((siblings) =>
    siblings.sort((left, right) => left.order - right.order),
  );

  const arcNodes = (children.get(root?.id) ?? []).filter(
    (node) => node.id !== root?.id,
  );
  const effectiveArcNodes = arcNodes.length
    ? arcNodes
    : [
        {
          id: createNarrativeId('arc'),
          title: '第一幕',
          summary: '',
          type: 'chapter' as const,
          order: 0,
        },
      ];

  effectiveArcNodes.forEach((arcNode, arcIndex) => {
    const arcId = arcNode.id;
    const chapterIds: string[] = [];
    document.arcs.push({
      id: arcId,
      type: 'arc',
      title: arcNode.title,
      summary: arcNode.summary,
      order: arcIndex,
      chapterIds,
    });
    const chapterNodes = (children.get(arcNode.id) ?? []).sort(
      compareOutlineOrder,
    );
    const explicitChapterNodes = chapterNodes.filter(
      (node) => node.type === 'chapter',
    );
    const effectiveChapterNodes = explicitChapterNodes.length
      ? explicitChapterNodes
      : [
          {
            id: createNarrativeId('chapter'),
            title: arcNode.title,
            summary: arcNode.summary,
            type: 'chapter' as const,
            order: 0,
          },
        ];

    effectiveChapterNodes.forEach((chapterNode, chapterIndex) => {
      const chapterId = chapterNode.id;
      const chapter: NarrativeChapter = {
        id: chapterId,
        type: 'chapter',
        title: chapterNode.title,
        summary: chapterNode.summary,
        order: chapterIndex,
        arcId,
        goals: [],
        openingState: '',
        beatIds: [],
        informationRelease: {
          readerKnows: [],
          characterKnows: [],
          mustNotReveal: [],
        },
        stateDelta: [],
        referenceIds: [],
      };
      chapterIds.push(chapterId);
      document.chapters.push(chapter);

      const addBeatTree = (node: OutlineNode) => {
        const beat: NarrativeBeat = {
          id: node.id,
          type: 'beat',
          title: node.title,
          summary: node.summary,
          order: chapter.beatIds.length,
          chapterId,
          referenceIds: [],
        };
        chapter.beatIds.push(node.id);
        document.beats.push(beat);
        if (node.type === 'character') {
          const assetId = `legacy-asset-${node.id}`;
          document.assets.push({
            id: assetId,
            type: 'role',
            refId: node.id,
            label: node.title,
            legacy: true,
          });
          beat.referenceIds.push(assetId);
        }
        (children.get(node.id) ?? [])
          .sort(compareOutlineOrder)
          .forEach(addBeatTree);
      };
      const addDescendantBeats = (parentId: string) => {
        (children.get(parentId) ?? [])
          .sort(compareOutlineOrder)
          .forEach(addBeatTree);
      };

      if (chapterNode.id === arcNode.id || !explicitChapterNodes.length) {
        addDescendantBeats(arcNode.id);
      } else {
        addDescendantBeats(chapterNode.id);
        if (chapterIndex === 0) {
          chapterNodes
            .filter((node) => node.type !== 'chapter')
            .forEach(addBeatTree);
        }
      }
    });
  });

  document.story.arcIds = document.arcs.map((arc) => arc.id);
  return normalizeNarrativeDocument(document);
}

function isNarrativeDocument(value: unknown): value is NarrativeDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NarrativeDocument>;
  const story = candidate.story;
  return (
    candidate.schemaVersion === NARRATIVE_DOCUMENT_SCHEMA_VERSION &&
    typeof candidate.rootStoryId === 'string' &&
    isRecord(story) &&
    typeof story.id === 'string' &&
    story.type === 'story' &&
    typeof story.title === 'string' &&
    typeof story.summary === 'string' &&
    isStringArray(story.arcIds) &&
    Array.isArray(candidate.arcs) &&
    candidate.arcs.every(
      (arc) =>
        isRecord(arc) &&
        typeof arc.id === 'string' &&
        arc.type === 'arc' &&
        typeof arc.title === 'string' &&
        typeof arc.summary === 'string' &&
        typeof arc.order === 'number' &&
        isStringArray(arc.chapterIds),
    ) &&
    Array.isArray(candidate.chapters) &&
    candidate.chapters.every(
      (chapter) =>
        isRecord(chapter) &&
        typeof chapter.id === 'string' &&
        chapter.type === 'chapter' &&
        typeof chapter.title === 'string' &&
        typeof chapter.summary === 'string' &&
        typeof chapter.order === 'number' &&
        typeof chapter.arcId === 'string' &&
        isStringArray(chapter.goals) &&
        typeof chapter.openingState === 'string' &&
        isStringArray(chapter.beatIds) &&
        isRecord(chapter.informationRelease) &&
        isStringArray(chapter.informationRelease.readerKnows) &&
        isStringArray(chapter.informationRelease.characterKnows) &&
        isStringArray(chapter.informationRelease.mustNotReveal) &&
        Array.isArray(chapter.stateDelta) &&
        isStringArray(chapter.referenceIds),
    ) &&
    Array.isArray(candidate.beats) &&
    candidate.beats.every(
      (beat) =>
        isRecord(beat) &&
        typeof beat.id === 'string' &&
        beat.type === 'beat' &&
        typeof beat.title === 'string' &&
        typeof beat.summary === 'string' &&
        typeof beat.order === 'number' &&
        typeof beat.chapterId === 'string' &&
        isStringArray(beat.referenceIds),
    ) &&
    Array.isArray(candidate.assets) &&
    candidate.assets.every(
      (asset) =>
        isRecord(asset) &&
        typeof asset.id === 'string' &&
        typeof asset.type === 'string' &&
        typeof asset.refId === 'string' &&
        typeof asset.label === 'string' &&
        (asset.parentId === undefined || typeof asset.parentId === 'string'),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isLegacyOutlineDocument(value: unknown): value is OutlineDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<OutlineDocument>;
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
}

function compareOutlineOrder(left: OutlineNode, right: OutlineNode) {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function compareNarrativeOrder(
  left: { id: string; order: number },
  right: { id: string; order: number },
) {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function createNarrativeId(type: NarrativeEntityType) {
  const random = Math.random().toString(36).slice(2, 9);
  return `narrative-${type}-${Date.now().toString(36)}-${random}`;
}
