import type { OutlineDocument, OutlineNode } from './story-outline-layout';
import type {
  OutlineEdge,
  OutlinePositionMap,
  OutlineView,
} from './story-outline-types';

export const NARRATIVE_DOCUMENT_SCHEMA_VERSION =
  'narrative-planning.v2' as const;
export const NARRATIVE_DOCUMENT_V1_SCHEMA_VERSION =
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
  parentId?: string;
  referenceIds: string[];
}

export interface NarrativeCanvasAssetNode {
  id: string;
  type: OutlineNode['type'];
  title: string;
  summary: string;
  order: number;
  parentId?: string;
  refId?: string;
  lane?: string;
  relation?: string;
  legacy?: boolean;
}

export type NarrativeCanvasNode = NarrativeBeat | NarrativeCanvasAssetNode;

export interface NarrativeCanvasDocument {
  nodes: NarrativeCanvasNode[];
  edges: OutlineEdge[];
  references: NarrativeAssetReference[];
  positionsByView: Partial<Record<OutlineView, OutlinePositionMap>>;
}

export interface NarrativeDocument {
  schemaVersion: typeof NARRATIVE_DOCUMENT_SCHEMA_VERSION;
  rootStoryId: string;
  story: NarrativeStory;
  arcs: NarrativeArc[];
  chapters: NarrativeChapter[];
  canvases: Record<string, NarrativeCanvasDocument>;
  updatedAt?: string;
}

export interface NarrativeDocumentV1 {
  schemaVersion: typeof NARRATIVE_DOCUMENT_V1_SCHEMA_VERSION;
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
  source: 'narrative-json' | 'legacy-outline' | 'empty' | 'invalid';
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
    chapters: [createChapter(chapterId, arcId, '第一章', 0)],
    canvases: {
      [storyId]: createEmptyCanvas(),
      [arcId]: createEmptyCanvas(),
      [chapterId]: createEmptyCanvas(),
    },
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
    const v1 = decodeNarrativeDocumentV1(value);
    if (v1) {
      return {
        document: migrateNarrativeDocumentV1(v1),
        migrated: true,
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
    // Preserve the unreadable artifact and let the workspace show an error.
  }

  return {
    document: createNarrativeDocument(fallback),
    migrated: false,
    source: 'invalid',
  };
}

export function normalizeNarrativeDocument(
  value: NarrativeDocument,
): NarrativeDocument {
  const story = { ...value.story };
  const arcs = value.arcs
    .map((arc, index) => ({
      ...arc,
      order: Number.isFinite(arc.order) ? arc.order : index,
      chapterIds: [...arc.chapterIds],
    }))
    .sort(compareNarrativeOrder);
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
    .sort(compareNarrativeOrder);

  const chaptersByArc = new Map<string, NarrativeChapter[]>();
  chapters.forEach((chapter) => {
    const siblings = chaptersByArc.get(chapter.arcId) ?? [];
    siblings.push(chapter);
    chaptersByArc.set(chapter.arcId, siblings);
  });
  arcs.forEach((arc) => {
    arc.chapterIds = (chaptersByArc.get(arc.id) ?? [])
      .sort(compareNarrativeOrder)
      .map((chapter) => chapter.id);
  });

  const ownerIds = [
    story.id,
    ...arcs.map((arc) => arc.id),
    ...chapters.map((chapter) => chapter.id),
  ];
  const canvases = Object.fromEntries(
    ownerIds.map((ownerId) => [
      ownerId,
      normalizeCanvas(value.canvases[ownerId], ownerId),
    ]),
  );
  chapters.forEach((chapter) => {
    chapter.beatIds = canvases[chapter.id]!.nodes.filter(
      (node): node is NarrativeBeat => node.type === 'beat',
    )
      .sort(compareNarrativeOrder)
      .map((beat) => beat.id);
  });

  return {
    ...value,
    schemaVersion: NARRATIVE_DOCUMENT_SCHEMA_VERSION,
    rootStoryId: story.id,
    story: { ...story, arcIds: arcs.map((arc) => arc.id) },
    arcs,
    chapters,
    canvases,
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
  const canvases = { ...document.canvases };
  delete canvases[arcId];

  return {
    document: normalizeNarrativeDocument({
      ...document,
      arcs: remainingArcs,
      chapters,
      canvases,
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

  const removedBeatIds = (document.canvases[chapterId]?.nodes ?? [])
    .filter((node) => node.type === 'beat')
    .map((node) => node.id);
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
  const canvases = { ...document.canvases };
  delete canvases[chapterId];

  return {
    document: normalizeNarrativeDocument({
      ...document,
      chapters,
      canvases,
    }),
    removed: true,
    parentArcId: chapter.arcId,
    removedBeatIds,
  };
}

export function narrativeDocumentToOutline(
  document: NarrativeDocument,
  ownerId = document.rootStoryId,
): OutlineDocument {
  const owner = findOwner(document, ownerId) ?? document.story;
  const canvas = document.canvases[owner.id] ?? createEmptyCanvas();
  const anchor: OutlineNode = {
    id: owner.id,
    title: owner.title,
    summary: owner.summary,
    type: 'chapter',
    lane: '主线',
    order: 0,
  };
  const nodes = canvas.nodes.map((node): OutlineNode =>
    node.type === 'beat'
      ? {
          id: node.id,
          title: node.title,
          summary: node.summary,
          type: 'event',
          parentId: node.parentId ?? owner.id,
          lane: 'Beat',
          order: node.order + 1,
        }
      : {
          id: node.id,
          title: node.title,
          summary: node.summary,
          type: node.type,
          parentId: node.parentId ?? owner.id,
          lane:
            node.lane ??
            (isNarrativeCanvasAssetType(node.type) ? '剧情资产' : undefined),
          order: node.order + 1,
        },
  );
  return {
    nodes: [anchor, ...nodes],
    edges: canvas.edges.map((edge) => ({ ...edge })),
  };
}

export function isNarrativeCanvasAssetType(
  type: unknown,
): type is NarrativeCanvasAssetType {
  return NARRATIVE_CANVAS_ASSET_TYPES.some((candidate) => candidate === type);
}

// The Server accepts v1 documents whose entities carry only an id and type,
// so the migration fills in the remaining fields with defaults before placing
// beats, materials, and references onto their owning canvases.
function normalizeV1Document(value: NarrativeDocumentV1): NarrativeDocumentV1 {
  const rawArcs = Array.isArray(value.arcs) ? value.arcs : [];
  const rawChapters = Array.isArray(value.chapters) ? value.chapters : [];
  const arcs = rawArcs.map((arc, index) => {
    const fallback = index === 0 ? '第一幕' : `第${index + 1}幕`;
    return {
      id: arc.id,
      type: 'arc' as const,
      title: typeof arc.title === 'string' ? arc.title : fallback,
      summary: typeof arc.summary === 'string' ? arc.summary : '',
      order: Number.isFinite(arc.order) ? arc.order : index,
      chapterIds: isStringArray(arc.chapterIds) ? [...arc.chapterIds] : [],
    };
  });
  const chapters = rawChapters.map((chapter, index) => {
    const fallback = `第${index + 1}章`;
    const informationRelease = isRecord(chapter.informationRelease)
      ? chapter.informationRelease
      : {};
    const arcId =
      typeof chapter.arcId === 'string' &&
      arcs.some((arc) => arc.id === chapter.arcId)
        ? chapter.arcId
        : // Orphaned chapters are re-homed onto the story canvas below.
          value.story.id;
    return {
      id: chapter.id,
      type: 'chapter' as const,
      title: typeof chapter.title === 'string' ? chapter.title : fallback,
      summary: typeof chapter.summary === 'string' ? chapter.summary : '',
      order: Number.isFinite(chapter.order) ? chapter.order : index,
      arcId,
      goals: isStringArray(chapter.goals) ? [...chapter.goals] : [],
      openingState:
        typeof chapter.openingState === 'string' ? chapter.openingState : '',
      beatIds: isStringArray(chapter.beatIds) ? [...chapter.beatIds] : [],
      informationRelease: {
        readerKnows: isStringArray(informationRelease.readerKnows)
          ? [...informationRelease.readerKnows]
          : [],
        characterKnows: isStringArray(informationRelease.characterKnows)
          ? [...informationRelease.characterKnows]
          : [],
        mustNotReveal: isStringArray(informationRelease.mustNotReveal)
          ? [...informationRelease.mustNotReveal]
          : [],
      },
      stateDelta: Array.isArray(chapter.stateDelta)
        ? chapter.stateDelta.filter(isRecord).map((delta) => ({ ...delta }))
        : [],
      referenceIds: isStringArray(chapter.referenceIds)
        ? [...chapter.referenceIds]
        : [],
    };
  });
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const beats = (Array.isArray(value.beats) ? value.beats : []).map(
    (beat, index) => ({
      id: beat.id,
      type: 'beat' as const,
      title: typeof beat.title === 'string' ? beat.title : `节拍${index + 1}`,
      summary: typeof beat.summary === 'string' ? beat.summary : '',
      order: Number.isFinite(beat.order) ? beat.order : index,
      // Beats whose owning chapter is missing or unknown join the story canvas.
      chapterId:
        typeof beat.chapterId === 'string' && chapterIds.has(beat.chapterId)
          ? beat.chapterId
          : value.story.id,
      parentId: typeof beat.parentId === 'string' ? beat.parentId : undefined,
      referenceIds: isStringArray(beat.referenceIds)
        ? [...beat.referenceIds]
        : [],
    }),
  );
  const assets = (Array.isArray(value.assets) ? value.assets : []).map(
    (asset, index) => ({
      id: asset.id,
      type: typeof asset.type === 'string' ? asset.type : 'event',
      refId: typeof asset.refId === 'string' ? asset.refId : asset.id,
      label: typeof asset.label === 'string' ? asset.label : `素材${index + 1}`,
      parentId: typeof asset.parentId === 'string' ? asset.parentId : undefined,
      relation: typeof asset.relation === 'string' ? asset.relation : undefined,
      legacy: typeof asset.legacy === 'boolean' ? asset.legacy : undefined,
    }),
  );
  return {
    schemaVersion: NARRATIVE_DOCUMENT_V1_SCHEMA_VERSION,
    rootStoryId: value.rootStoryId,
    story: {
      id: value.story.id,
      type: 'story',
      title: value.story.title,
      summary: value.story.summary,
      arcIds: isStringArray(value.story.arcIds)
        ? [...value.story.arcIds]
        : arcs.map((arc) => arc.id),
    },
    arcs,
    chapters,
    beats,
    assets,
    updatedAt:
      typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
  };
}

function migrateNarrativeDocumentV1(
  value: NarrativeDocumentV1,
): NarrativeDocument {
  const normalized = normalizeV1Document(value);
  const storyId = normalized.story.id;
  // The tolerant normalization points orphaned chapters at the story id; they
  // lose their structural role and re-materialize as story-canvas nodes so the
  // migrated v2 document never carries a chapter without a real parent arc.
  const structuralChapters = normalized.chapters.filter(
    (chapter) => chapter.arcId !== storyId,
  );
  const demotedChapters = normalized.chapters.filter(
    (chapter) => chapter.arcId === storyId,
  );
  const canvases: Record<string, NarrativeCanvasDocument> = {};
  const ownerIds = [
    storyId,
    ...normalized.arcs.map((arc) => arc.id),
    ...structuralChapters.map((chapter) => chapter.id),
  ];
  ownerIds.forEach((ownerId) => {
    canvases[ownerId] = createEmptyCanvas();
  });

  const beatOwner = new Map(
    normalized.beats.map((beat) => [beat.id, beat.chapterId]),
  );
  const structuralOwner = new Map<string, string>([
    [storyId, storyId],
    ...normalized.arcs.map((arc) => [arc.id, arc.id] as const),
    ...structuralChapters.map((chapter) => [chapter.id, chapter.id] as const),
    ...normalized.beats.map((beat) => [beat.id, beat.chapterId] as const),
    ...demotedChapters.map((chapter) => [chapter.id, storyId] as const),
  ]);

  demotedChapters.forEach((chapter, index) => {
    canvases[storyId]!.nodes.push({
      id: chapter.id,
      type: 'chapter',
      title: chapter.title,
      summary: chapter.summary,
      order: index,
      parentId: storyId,
    });
  });

  normalized.beats.forEach((beat) => {
    const ownerId = canvases[beat.chapterId] ? beat.chapterId : storyId;
    const parentId =
      beat.parentId && structuralOwner.get(beat.parentId) === ownerId
        ? beat.parentId
        : ownerId;
    canvases[ownerId]!.nodes.push({
      ...beat,
      chapterId: ownerId,
      parentId,
      referenceIds: [...beat.referenceIds],
    });
    canvases[ownerId]!.edges.push({
      id: `narrative-parent-${parentId}-${beat.id}`,
      source: parentId,
      target: beat.id,
      kind: 'sequence',
    });
  });

  const canvasAssets = normalized.assets.filter((asset) =>
    isNarrativeCanvasAssetType(asset.type),
  );
  const assetById = new Map(canvasAssets.map((asset) => [asset.id, asset]));
  const resolving = new Set<string>();
  const resolveAssetOwner = (asset: NarrativeAssetReference): string => {
    const directOwner = asset.parentId
      ? structuralOwner.get(asset.parentId)
      : undefined;
    if (directOwner && canvases[directOwner]) return directOwner;
    const parentAsset = asset.parentId
      ? assetById.get(asset.parentId)
      : undefined;
    if (!parentAsset || resolving.has(asset.id)) return normalized.story.id;
    resolving.add(asset.id);
    const owner = resolveAssetOwner(parentAsset);
    resolving.delete(asset.id);
    return owner;
  };
  canvasAssets.forEach((asset, index) => {
    const assetType = asset.type as NarrativeCanvasAssetType;
    const ownerId = resolveAssetOwner(asset);
    const parentOwner = asset.parentId
      ? (structuralOwner.get(asset.parentId) ??
        (assetById.has(asset.parentId)
          ? resolveAssetOwner(assetById.get(asset.parentId)!)
          : undefined))
      : undefined;
    const parentId =
      parentOwner === ownerId && asset.parentId ? asset.parentId : ownerId;
    canvases[ownerId]!.nodes.push({
      id: asset.id,
      type: assetType,
      title: asset.label,
      summary: asset.relation ?? '',
      order: index,
      parentId,
      refId: asset.refId,
      legacy: asset.legacy,
    });
    canvases[ownerId]!.edges.push({
      id: `narrative-asset-${parentId}-${asset.id}`,
      source: parentId,
      target: asset.id,
      kind: 'relation',
      label: NARRATIVE_CANVAS_ASSET_LABELS[assetType],
    });
  });

  const referenceOwners = new Map<string, Set<string>>();
  structuralChapters.forEach((chapter) => {
    chapter.referenceIds.forEach((referenceId) => {
      const owners = referenceOwners.get(referenceId) ?? new Set<string>();
      owners.add(chapter.id);
      referenceOwners.set(referenceId, owners);
    });
  });
  normalized.beats.forEach((beat) => {
    beat.referenceIds.forEach((referenceId) => {
      const owners = referenceOwners.get(referenceId) ?? new Set<string>();
      const beatChapterId = beatOwner.get(beat.id);
      owners.add(
        beatChapterId && canvases[beatChapterId]
          ? beatChapterId
          : normalized.story.id,
      );
      referenceOwners.set(referenceId, owners);
    });
  });
  normalized.assets
    .filter((asset) => !isNarrativeCanvasAssetType(asset.type))
    .forEach((reference) => {
      const parentOwner = reference.parentId
        ? (structuralOwner.get(reference.parentId) ??
          (assetById.has(reference.parentId)
            ? resolveAssetOwner(assetById.get(reference.parentId)!)
            : undefined))
        : undefined;
      const owners =
        referenceOwners.get(reference.id) ??
        new Set([parentOwner ?? normalized.story.id]);
      owners.forEach((ownerId) => {
        const effectiveOwnerId = canvases[ownerId]
          ? ownerId
          : normalized.story.id;
        const ownerCanvas = canvases[effectiveOwnerId]!;
        const localIds = new Set([
          effectiveOwnerId,
          ...ownerCanvas.nodes.map((node) => node.id),
        ]);
        ownerCanvas.references.push({
          ...reference,
          parentId:
            reference.parentId && localIds.has(reference.parentId)
              ? reference.parentId
              : effectiveOwnerId,
        });
      });
    });

  return normalizeNarrativeDocument({
    schemaVersion: NARRATIVE_DOCUMENT_SCHEMA_VERSION,
    rootStoryId: storyId,
    story: { ...normalized.story, arcIds: [...normalized.story.arcIds] },
    arcs: normalized.arcs.map((arc) => ({
      ...arc,
      chapterIds: [...arc.chapterIds],
    })),
    chapters: structuralChapters.map(cloneChapter),
    canvases,
    updatedAt: normalized.updatedAt,
  });
}

function migrateLegacyOutline(
  legacy: OutlineDocument,
  fallback: { title: string; summary?: string },
): NarrativeDocument {
  const root =
    legacy.nodes.find((node) => !node.parentId) ?? legacy.nodes[0] ?? null;
  const seed = createNarrativeDocument({
    storyId: root?.id,
    title: root?.title ?? fallback.title,
    summary: root?.summary ?? fallback.summary,
  });
  const v1: NarrativeDocumentV1 = {
    schemaVersion: NARRATIVE_DOCUMENT_V1_SCHEMA_VERSION,
    rootStoryId: seed.story.id,
    story: { ...seed.story, arcIds: [] },
    arcs: [],
    chapters: [],
    beats: [],
    assets: [],
  };
  const children = new Map<string | undefined, OutlineNode[]>();
  legacy.nodes.forEach((node) => {
    if (node.id === root?.id) return;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  });
  children.forEach((siblings) => siblings.sort(compareOutlineOrder));

  const rootChildren = children.get(root?.id) ?? [];
  const arcNodes = rootChildren.length
    ? rootChildren
    : [
        {
          id: createNarrativeId('arc'),
          title: '第一幕',
          summary: '',
          type: 'chapter' as const,
          order: 0,
        },
      ];
  arcNodes.forEach((arcNode, arcIndex) => {
    const arc: NarrativeArc = {
      id: arcNode.id,
      type: 'arc',
      title: arcNode.title,
      summary: arcNode.summary,
      order: arcIndex,
      chapterIds: [],
    };
    v1.arcs.push(arc);
    const directChildren = children.get(arcNode.id) ?? [];
    const explicitChapters = directChildren.filter(
      (node) => node.type === 'chapter',
    );
    const chapterNodes = explicitChapters.length
      ? explicitChapters
      : [
          {
            id: createNarrativeId('chapter'),
            title: arcNode.title,
            summary: arcNode.summary,
            type: 'chapter' as const,
            order: 0,
          },
        ];
    chapterNodes.forEach((chapterNode, chapterIndex) => {
      const chapter = createChapter(
        chapterNode.id,
        arc.id,
        chapterNode.title,
        chapterIndex,
        chapterNode.summary,
      );
      arc.chapterIds.push(chapter.id);
      v1.chapters.push(chapter);
      const addDescendant = (node: OutlineNode, parentId?: string) => {
        const beat: NarrativeBeat = {
          id: node.id,
          type: 'beat',
          title: node.title,
          summary: node.summary,
          order: chapter.beatIds.length,
          chapterId: chapter.id,
          parentId: parentId ?? chapter.id,
          referenceIds: [],
        };
        chapter.beatIds.push(beat.id);
        v1.beats.push(beat);
        if (node.type === 'character') {
          const referenceId = `legacy-asset-${node.id}`;
          v1.assets.push({
            id: referenceId,
            type: 'role',
            refId: node.id,
            label: node.title,
            legacy: true,
          });
          beat.referenceIds.push(referenceId);
        }
        (children.get(node.id) ?? []).forEach((child) =>
          addDescendant(child, node.id),
        );
      };
      const descendantRoots =
        chapterNode.id === arcNode.id || !explicitChapters.length
          ? directChildren
          : (children.get(chapterNode.id) ?? []);
      descendantRoots.forEach((node) => addDescendant(node));
      if (chapterIndex === 0 && explicitChapters.length) {
        directChildren
          .filter((node) => node.type !== 'chapter')
          .forEach((node) => addDescendant(node));
      }
    });
  });
  v1.story.arcIds = v1.arcs.map((arc) => arc.id);
  return migrateNarrativeDocumentV1(v1);
}

function createEmptyCanvas(): NarrativeCanvasDocument {
  return { nodes: [], edges: [], references: [], positionsByView: {} };
}

function normalizeCanvas(
  canvas: NarrativeCanvasDocument | undefined,
  ownerId: string,
): NarrativeCanvasDocument {
  if (!canvas) return createEmptyCanvas();
  const nodes = canvas.nodes
    .filter((node) => node.id !== ownerId)
    .map((node) =>
      node.type === 'beat'
        ? { ...node, referenceIds: [...node.referenceIds] }
        : { ...node },
    );
  const positionsByView: NarrativeCanvasDocument['positionsByView'] = {};
  Object.entries(canvas.positionsByView).forEach(([view, positions]) => {
    if (!positions) return;
    positionsByView[view as OutlineView] = Object.fromEntries(
      Object.entries(positions).map(([id, position]) => [id, { ...position }]),
    );
  });
  return {
    nodes,
    edges: canvas.edges.map((edge) => ({ ...edge })),
    references: canvas.references.map((reference) => ({ ...reference })),
    positionsByView,
  };
}

function findOwner(document: NarrativeDocument, ownerId: string) {
  if (document.story.id === ownerId) return document.story;
  return (
    document.arcs.find((arc) => arc.id === ownerId) ??
    document.chapters.find((chapter) => chapter.id === ownerId)
  );
}

function createChapter(
  id: string,
  arcId: string,
  title: string,
  order: number,
  summary = '',
): NarrativeChapter {
  return {
    id,
    type: 'chapter',
    title,
    summary,
    order,
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
}

function cloneChapter(chapter: NarrativeChapter): NarrativeChapter {
  return {
    ...chapter,
    goals: [...chapter.goals],
    beatIds: [...chapter.beatIds],
    referenceIds: [...chapter.referenceIds],
    informationRelease: {
      readerKnows: [...chapter.informationRelease.readerKnows],
      characterKnows: [...chapter.informationRelease.characterKnows],
      mustNotReveal: [...chapter.informationRelease.mustNotReveal],
    },
    stateDelta: chapter.stateDelta.map((delta) => ({ ...delta })),
  };
}

function isNarrativeDocument(value: unknown): value is NarrativeDocument {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === NARRATIVE_DOCUMENT_SCHEMA_VERSION &&
    isNarrativeStructure(value) &&
    isRecord(value.canvases) &&
    Object.values(value.canvases).every(isNarrativeCanvasDocument)
  );
}

function isNarrativeDocumentV1(value: unknown): value is NarrativeDocumentV1 {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === NARRATIVE_DOCUMENT_V1_SCHEMA_VERSION &&
    typeof value.rootStoryId === 'string' &&
    isNarrativeStory(value.story) &&
    Array.isArray(value.arcs) &&
    value.arcs.every((arc) => isV1Entity(arc, 'arc')) &&
    Array.isArray(value.chapters) &&
    value.chapters.every((chapter) => isV1Entity(chapter, 'chapter')) &&
    Array.isArray(value.beats) &&
    value.beats.every((beat) => isV1Entity(beat, 'beat')) &&
    Array.isArray(value.assets) &&
    value.assets.every((asset) => isV1Entity(asset))
  );
}

// The Server's v1 acceptance only requires each entity to carry an id (and a
// matching type for arcs/chapters/beats); the migration fills in the rest.
function isV1Entity(value: unknown, type?: string): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (type === undefined || value.type === type)
  );
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function decodeNarrativeDocumentV1(value: unknown): NarrativeDocumentV1 | null {
  if (!isNarrativeDocumentV1(value)) return null;

  const rawArcs = value.arcs as Record<string, unknown>[];
  const rawChapters = value.chapters as Record<string, unknown>[];
  const rawBeats = value.beats as Record<string, unknown>[];
  const rawAssets = value.assets as Record<string, unknown>[];
  const usedIds = new Set([value.story.id]);
  const mappedArcIds = rawArcs.map((arc, index) =>
    claimMigratedId(arc.id, 'arc', index, usedIds),
  );
  const mappedChapterIds = rawChapters.map((chapter, index) =>
    claimMigratedId(chapter.id, 'chapter', index, usedIds),
  );
  const mappedBeatIds = rawBeats.map((beat, index) =>
    claimMigratedId(beat.id, 'beat', index, usedIds),
  );
  const mappedAssetIds = rawAssets.map((asset, index) =>
    claimMigratedId(asset.id, 'asset', index, usedIds),
  );
  const arcIdByRawId = firstMapping(rawArcs, mappedArcIds);
  const chapterIdByRawId = firstMapping(rawChapters, mappedChapterIds);
  const beatIdByRawId = firstMapping(rawBeats, mappedBeatIds);
  const assetIdByRawId = firstMapping(rawAssets, mappedAssetIds);
  const arcIdByChapterRawId = new Map<string, string>();
  rawArcs.forEach((arc, index) => {
    readStringArray(arc.chapterIds).forEach((chapterId) => {
      if (!arcIdByChapterRawId.has(chapterId)) {
        arcIdByChapterRawId.set(chapterId, mappedArcIds[index]!);
      }
    });
  });
  const structuralChapterByRawId = new Map<string, string>();
  rawChapters.forEach((chapter, index) => {
    const rawArcId = readString(chapter.arcId);
    const arcId =
      (rawArcId ? arcIdByRawId.get(rawArcId) : undefined) ??
      arcIdByChapterRawId.get(chapter.id);
    if (arcId)
      structuralChapterByRawId.set(chapter.id, mappedChapterIds[index]!);
  });
  const chapterByBeatRawId = new Map<string, string>();
  rawChapters.forEach((chapter) => {
    const chapterId = structuralChapterByRawId.get(chapter.id);
    if (!chapterId) return;
    readStringArray(chapter.beatIds).forEach((beatId) => {
      if (!chapterByBeatRawId.has(beatId))
        chapterByBeatRawId.set(beatId, chapterId);
    });
  });
  const mapReferenceId = (referenceId: string) =>
    assetIdByRawId.get(referenceId) ??
    beatIdByRawId.get(referenceId) ??
    chapterIdByRawId.get(referenceId) ??
    arcIdByRawId.get(referenceId) ??
    referenceId;

  const arcs: NarrativeArc[] = rawArcs.map((arc, index) => ({
    id: mappedArcIds[index]!,
    type: 'arc',
    title: readString(arc.title) || `第${index + 1}幕`,
    summary: readString(arc.summary),
    order: readFiniteNumber(arc.order, index),
    chapterIds: [],
  }));
  const chapters: NarrativeChapter[] = [];
  const orphanChapterAssets: NarrativeAssetReference[] = [];
  rawChapters.forEach((chapter, index) => {
    const rawArcId = readString(chapter.arcId);
    const arcId =
      (rawArcId ? arcIdByRawId.get(rawArcId) : undefined) ??
      arcIdByChapterRawId.get(chapter.id);
    const chapterId = mappedChapterIds[index]!;
    if (!arcId) {
      orphanChapterAssets.push({
        id: chapterId,
        type: 'event',
        refId: chapterId,
        label: readString(chapter.title) || `未归属章节 ${index + 1}`,
        relation: readString(chapter.summary) || undefined,
        legacy: true,
      });
      return;
    }
    const release = isRecord(chapter.informationRelease)
      ? {
          readerKnows: readStringArray(chapter.informationRelease.readerKnows),
          characterKnows: readStringArray(
            chapter.informationRelease.characterKnows,
          ),
          mustNotReveal: readStringArray(
            chapter.informationRelease.mustNotReveal,
          ),
        }
      : { readerKnows: [], characterKnows: [], mustNotReveal: [] };
    chapters.push({
      id: chapterId,
      type: 'chapter',
      title: readString(chapter.title) || `第${index + 1}章`,
      summary: readString(chapter.summary),
      order: readFiniteNumber(chapter.order, index),
      arcId,
      goals: readStringArray(chapter.goals),
      openingState: readString(chapter.openingState),
      beatIds: [],
      informationRelease: release,
      stateDelta: Array.isArray(chapter.stateDelta)
        ? chapter.stateDelta.filter(isRecord).map((delta) => ({ ...delta }))
        : [],
      referenceIds: readStringArray(chapter.referenceIds).map(mapReferenceId),
    });
  });
  const structuralChapterIds = new Set(chapters.map((chapter) => chapter.id));
  const beats: NarrativeBeat[] = rawBeats.map((beat, index) => {
    const rawChapterId = readString(beat.chapterId);
    const directChapterId = rawChapterId
      ? structuralChapterByRawId.get(rawChapterId)
      : undefined;
    const chapterId =
      (directChapterId && structuralChapterIds.has(directChapterId)
        ? directChapterId
        : undefined) ??
      chapterByBeatRawId.get(beat.id) ??
      value.story.id;
    const rawParentId = readString(beat.parentId);
    return {
      id: mappedBeatIds[index]!,
      type: 'beat',
      title: readString(beat.title) || `节拍 ${index + 1}`,
      summary: readString(beat.summary),
      order: readFiniteNumber(beat.order, index),
      chapterId,
      parentId:
        (rawParentId ? beatIdByRawId.get(rawParentId) : undefined) ?? chapterId,
      referenceIds: readStringArray(beat.referenceIds).map(mapReferenceId),
    };
  });
  const assets: NarrativeAssetReference[] = rawAssets.map((asset, index) => {
    const rawType = readString(asset.type);
    const type: NarrativeAssetReference['type'] =
      rawType === 'role' || rawType === 'worldview'
        ? rawType
        : isNarrativeCanvasAssetType(rawType)
          ? rawType
          : 'event';
    const rawParentId = readString(asset.parentId);
    return {
      id: mappedAssetIds[index]!,
      type,
      refId: readString(asset.refId) || mappedAssetIds[index]!,
      label:
        readString(asset.label) ||
        readString(asset.title) ||
        `素材 ${index + 1}`,
      parentId: rawParentId ? mapReferenceId(rawParentId) : undefined,
      relation: readString(asset.relation) || undefined,
      legacy: asset.legacy === true,
    };
  });
  const knownReferenceIds = new Set(assets.map((asset) => asset.id));
  [
    ...chapters.flatMap((chapter) => chapter.referenceIds),
    ...beats.flatMap((beat) => beat.referenceIds),
  ]
    .filter((referenceId) => !knownReferenceIds.has(referenceId))
    .forEach((referenceId) => {
      knownReferenceIds.add(referenceId);
      assets.push({
        id: referenceId,
        type: 'role',
        refId: referenceId,
        label: `历史引用 ${referenceId}`,
        legacy: true,
      });
    });
  arcs.forEach((arc) => {
    arc.chapterIds = chapters
      .filter((chapter) => chapter.arcId === arc.id)
      .sort(compareNarrativeOrder)
      .map((chapter) => chapter.id);
  });
  return {
    schemaVersion: NARRATIVE_DOCUMENT_V1_SCHEMA_VERSION,
    rootStoryId: value.story.id,
    story: { ...value.story, arcIds: arcs.map((arc) => arc.id) },
    arcs,
    chapters,
    beats,
    assets: [...assets, ...orphanChapterAssets],
    updatedAt: readString(value.updatedAt) || undefined,
  };
}

function firstMapping(
  records: Record<string, unknown>[],
  mappedIds: string[],
): Map<string, string> {
  const result = new Map<string, string>();
  records.forEach((record, index) => {
    if (typeof record.id === 'string' && !result.has(record.id)) {
      result.set(record.id, mappedIds[index]!);
    }
  });
  return result;
}

function claimMigratedId(
  rawId: unknown,
  type: NarrativeEntityType | 'asset',
  index: number,
  usedIds: Set<string>,
): string {
  const base =
    typeof rawId === 'string' && rawId.trim()
      ? rawId.trim()
      : `narrative-${type}-migrated-${index + 1}`;
  let candidate = base;
  let suffix = 1;
  while (usedIds.has(candidate)) candidate = `${base}-migrated-${suffix++}`;
  usedIds.add(candidate);
  return candidate;
}

function isNarrativeStructure(value: Record<string, unknown>) {
  return (
    typeof value.rootStoryId === 'string' &&
    isNarrativeStory(value.story) &&
    Array.isArray(value.arcs) &&
    value.arcs.every(isNarrativeArc) &&
    Array.isArray(value.chapters) &&
    value.chapters.every(isNarrativeChapter)
  );
}

function isNarrativeStory(value: unknown): value is NarrativeStory {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.type === 'story' &&
    typeof value.title === 'string' &&
    typeof value.summary === 'string' &&
    isStringArray(value.arcIds)
  );
}

function isNarrativeArc(value: unknown): value is NarrativeArc {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.type === 'arc' &&
    typeof value.title === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.order === 'number' &&
    isStringArray(value.chapterIds)
  );
}

function isNarrativeChapter(value: unknown): value is NarrativeChapter {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.type === 'chapter' &&
    typeof value.title === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.order === 'number' &&
    typeof value.arcId === 'string' &&
    isStringArray(value.goals) &&
    typeof value.openingState === 'string' &&
    isStringArray(value.beatIds) &&
    isRecord(value.informationRelease) &&
    isStringArray(value.informationRelease.readerKnows) &&
    isStringArray(value.informationRelease.characterKnows) &&
    isStringArray(value.informationRelease.mustNotReveal) &&
    Array.isArray(value.stateDelta) &&
    isStringArray(value.referenceIds)
  );
}

function isNarrativeBeat(value: unknown): value is NarrativeBeat {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.type === 'beat' &&
    typeof value.title === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.order === 'number' &&
    typeof value.chapterId === 'string' &&
    isStringArray(value.referenceIds)
  );
}

function isNarrativeCanvasDocument(
  value: unknown,
): value is NarrativeCanvasDocument {
  return (
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(
      (node) =>
        isNarrativeBeat(node) ||
        (isRecord(node) &&
          typeof node.id === 'string' &&
          isOutlineCanvasNodeType(node.type) &&
          typeof node.title === 'string' &&
          typeof node.summary === 'string' &&
          typeof node.order === 'number'),
    ) &&
    Array.isArray(value.edges) &&
    Array.isArray(value.references) &&
    value.references.every(isNarrativeReference) &&
    isRecord(value.positionsByView)
  );
}

function isOutlineCanvasNodeType(type: unknown): type is OutlineNode['type'] {
  return (
    isNarrativeCanvasAssetType(type) ||
    type === 'character' ||
    type === 'conflict' ||
    type === 'chapter'
  );
}

function isNarrativeReference(
  value: unknown,
): value is NarrativeAssetReference {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    typeof value.refId === 'string' &&
    typeof value.label === 'string' &&
    (value.parentId === undefined || typeof value.parentId === 'string')
  );
}

function isLegacyOutlineDocument(value: unknown): value is OutlineDocument {
  if (!isRecord(value)) return false;
  return Array.isArray(value.nodes) && Array.isArray(value.edges);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
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
