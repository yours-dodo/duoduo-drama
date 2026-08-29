import { describe, expect, it } from 'vitest';

import { createOutlineSeed } from './story-outline-layout';
import {
  createNarrativeDocument,
  narrativeDocumentToOutline,
  normalizeNarrativeDocument,
  parseNarrativeDocument,
  removeNarrativeArc,
  removeNarrativeChapter,
  NARRATIVE_DOCUMENT_SCHEMA_VERSION,
  type NarrativeDocumentV1,
} from './story-narrative-types';

describe('narrative document v2 adapter', () => {
  it('creates one independent empty canvas for the story, default arc, and default chapter', () => {
    const document = createNarrativeDocument({ title: '  夜航船  ' });
    const ownerIds = [
      document.story.id,
      document.arcs[0]!.id,
      document.chapters[0]!.id,
    ];

    expect(document.schemaVersion).toBe(NARRATIVE_DOCUMENT_SCHEMA_VERSION);
    expect(document.story.title).toBe('夜航船');
    expect(Object.keys(document.canvases).sort()).toEqual(ownerIds.sort());
    expect(Object.values(document.canvases)).toEqual(
      ownerIds.map(() => ({
        nodes: [],
        edges: [],
        references: [],
        positionsByView: {},
      })),
    );
  });

  it('normalizes hierarchy and exact canvas ownership without storing owner anchors', () => {
    const original = createNarrativeDocument({ title: '故事' });
    const arc = original.arcs[0]!;
    const chapter = original.chapters[0]!;
    const normalized = normalizeNarrativeDocument({
      ...original,
      arcs: [{ ...arc, order: 4, chapterIds: ['stale'] }],
      chapters: [{ ...chapter, order: 2, beatIds: ['beat-1'] }],
      canvases: {
        ...original.canvases,
        [chapter.id]: {
          nodes: [
            {
              id: chapter.id,
              type: 'chapter',
              title: '重复锚点',
              summary: '',
              order: 0,
            },
            {
              id: 'beat-1',
              type: 'beat',
              title: '转折',
              summary: '',
              order: 0,
              chapterId: chapter.id,
              referenceIds: [],
            },
            {
              id: 'character-1',
              type: 'character',
              title: '旧画布角色',
              summary: '',
              order: 1,
              parentId: chapter.id,
              lane: '人物',
            },
          ],
          edges: [],
          references: [],
          positionsByView: {
            'timeline-horizontal': { 'beat-1': { x: 12, y: 34 } },
          },
        },
        orphan: {
          nodes: [],
          edges: [],
          references: [],
          positionsByView: {},
        },
      },
    });

    expect(normalized.story.arcIds).toEqual([arc.id]);
    expect(normalized.arcs[0]?.chapterIds).toEqual([chapter.id]);
    expect(Object.keys(normalized.canvases).sort()).toEqual(
      [normalized.story.id, arc.id, chapter.id].sort(),
    );
    expect(
      normalized.canvases[chapter.id]?.nodes.map((node) => node.id),
    ).toEqual(['beat-1', 'character-1']);
    expect(normalized.canvases[chapter.id]?.positionsByView).not.toBe(
      original.canvases[chapter.id]?.positionsByView,
    );
    expect(
      parseNarrativeDocument(JSON.stringify(normalized), {
        title: '回退',
      }).document.canvases[chapter.id]?.nodes.map((node) => node.id),
    ).toEqual(['beat-1', 'character-1']);
  });

  it('migrates v1 beats, materials, and external references to their owning canvases', () => {
    const result = parseNarrativeDocument(JSON.stringify(createV1Fixture()), {
      title: '迁移',
    });

    expect(result.source).toBe('narrative-json');
    expect(result.migrated).toBe(true);
    expect(result.document.schemaVersion).toBe('narrative-planning.v2');
    expect(
      result.document.canvases['chapter-1']?.nodes.map((node) => node.id),
    ).toEqual(['beat-1', 'event-1']);
    expect(
      result.document.canvases['chapter-1']?.references.map(
        (reference) => reference.id,
      ),
    ).toEqual(['role-ref-1']);
    expect(
      result.document.canvases['arc-1']?.nodes.map((node) => node.id),
    ).toEqual(['mystery-1']);
    expect(
      result.document.canvases['story-1']?.nodes.map((node) => node.id),
    ).toEqual(['unresolved-1']);
  });

  it('tolerantly migrates the partial v1 shapes accepted by the Server', () => {
    const result = parseNarrativeDocument(
      JSON.stringify({
        schemaVersion: 'narrative-planning.v1',
        rootStoryId: 'story-1',
        story: {
          id: 'story-1',
          type: 'story',
          title: '历史故事',
          summary: '',
          arcIds: ['arc-1'],
        },
        arcs: [{ id: 'arc-1', type: 'arc' }],
        chapters: [{ id: 'chapter-1', type: 'chapter' }],
        beats: [{ id: 'beat-1', type: 'beat' }],
        assets: [{ id: 'asset-1' }],
      }),
      { title: '迁移' },
    );

    expect(result.source).toBe('narrative-json');
    expect(result.migrated).toBe(true);
    expect(result.document.arcs[0]).toMatchObject({
      id: 'arc-1',
      title: '第1幕',
    });
    expect(
      result.document.canvases['story-1']?.nodes.map((node) => node.id),
    ).toEqual(expect.arrayContaining(['chapter-1', 'beat-1', 'asset-1']));
  });

  it('marks unreadable non-empty content invalid instead of scheduling an empty migration', () => {
    const result = parseNarrativeDocument('{"schemaVersion":"unknown"}', {
      title: '不得覆盖',
    });

    expect(result.source).toBe('invalid');
    expect(result.migrated).toBe(false);
  });

  it('migrates legacy outline trees without dropping recoverable node content', () => {
    const legacy = createOutlineSeed();
    const result = parseNarrativeDocument(JSON.stringify(legacy), {
      title: '迁移故事',
    });
    const migratedTitles = Object.values(result.document.canvases)
      .flatMap((canvas) => canvas.nodes)
      .map((node) => node.title);
    const migratedReferenceLabels = Object.values(result.document.canvases)
      .flatMap((canvas) => canvas.references)
      .map((reference) => reference.label);

    expect(result.source).toBe('legacy-outline');
    expect(result.migrated).toBe(true);
    expect(result.document.story.title).toBe('一封未寄出的信');
    legacy.nodes.slice(1).forEach((node) => {
      const preservedAsStructure = [
        ...result.document.arcs,
        ...result.document.chapters,
      ].some((entity) => entity.title === node.title);
      expect(
        preservedAsStructure ||
          migratedTitles.includes(node.title) ||
          migratedReferenceLabels.includes(node.title),
      ).toBe(true);
    });
  });

  it('derives only the selected owner anchor and renders only that canvas', () => {
    const document = parseNarrativeDocument(JSON.stringify(createV1Fixture()), {
      title: '迁移',
    }).document;

    const storyOutline = narrativeDocumentToOutline(document, 'story-1');
    const arcOutline = narrativeDocumentToOutline(document, 'arc-1');
    const chapterOutline = narrativeDocumentToOutline(document, 'chapter-1');

    expect(storyOutline.nodes.map((node) => node.id)).toEqual([
      'story-1',
      'unresolved-1',
    ]);
    expect(arcOutline.nodes.map((node) => node.id)).toEqual([
      'arc-1',
      'mystery-1',
    ]);
    expect(chapterOutline.nodes.map((node) => node.id)).toEqual([
      'chapter-1',
      'beat-1',
      'event-1',
    ]);
    expect(storyOutline.nodes.some((node) => node.id === 'arc-1')).toBe(false);
    expect(storyOutline.nodes.some((node) => node.id === 'chapter-1')).toBe(
      false,
    );
  });
});

describe('narrative canvas lifecycle', () => {
  it('normalization creates a missing canvas for newly added structure', () => {
    const document = createNarrativeDocument({ title: '新增结构' });
    const normalized = normalizeNarrativeDocument({
      ...document,
      arcs: [
        ...document.arcs,
        {
          ...document.arcs[0]!,
          id: 'arc-new',
          order: 1,
          chapterIds: [],
        },
      ],
    });

    expect(normalized.canvases['arc-new']).toEqual({
      nodes: [],
      edges: [],
      references: [],
      positionsByView: {},
    });
  });

  it('removes an arc canvas while preserving migrated chapter canvases', () => {
    const document = createArcRemovalFixture();
    const middleChapterCanvas = document.canvases['chapter-middle-a'];

    const result = removeNarrativeArc(document, 'arc-middle');

    expect(result.removed).toBe(true);
    expect(result.targetArcId).toBe('arc-first');
    expect(result.migratedChapterIds).toEqual([
      'chapter-middle-a',
      'chapter-middle-b',
    ]);
    expect(result.document.canvases['arc-middle']).toBeUndefined();
    expect(result.document.canvases['chapter-middle-a']).toEqual(
      middleChapterCanvas,
    );
    expect(
      result.document.chapters
        .filter((chapter) => chapter.arcId === 'arc-first')
        .map((chapter) => chapter.id),
    ).toEqual(['chapter-first', 'chapter-middle-a', 'chapter-middle-b']);
  });

  it('removes a chapter canvas and reports its removed beat ids', () => {
    const document = createArcRemovalFixture();

    const result = removeNarrativeChapter(document, 'chapter-middle-a');

    expect(result.removed).toBe(true);
    expect(result.removedBeatIds).toEqual(['beat-middle']);
    expect(result.document.canvases['chapter-middle-a']).toBeUndefined();
    expect(
      result.document.arcs.find((arc) => arc.id === 'arc-middle')?.chapterIds,
    ).toEqual(['chapter-middle-b']);
  });

  it('keeps unchanged documents for invalid removal requests', () => {
    const document = createNarrativeDocument({ title: '守卫' });

    expect(removeNarrativeArc(document, 'missing').document).toBe(document);
    expect(removeNarrativeArc(document, document.arcs[0]!.id).reason).toBe(
      'last-arc',
    );
    expect(removeNarrativeChapter(document, 'missing').document).toBe(document);
  });
});

function createV1Fixture(): NarrativeDocumentV1 {
  return {
    schemaVersion: 'narrative-planning.v1',
    rootStoryId: 'story-1',
    story: {
      id: 'story-1',
      type: 'story',
      title: '旧故事',
      summary: '总纲',
      arcIds: ['arc-1'],
    },
    arcs: [
      {
        id: 'arc-1',
        type: 'arc',
        title: '第一幕',
        summary: '',
        order: 0,
        chapterIds: ['chapter-1'],
      },
    ],
    chapters: [
      {
        id: 'chapter-1',
        type: 'chapter',
        title: '第一章',
        summary: '',
        order: 0,
        arcId: 'arc-1',
        goals: [],
        openingState: '',
        beatIds: ['beat-1'],
        informationRelease: {
          readerKnows: [],
          characterKnows: [],
          mustNotReveal: [],
        },
        stateDelta: [],
        referenceIds: [],
      },
    ],
    beats: [
      {
        id: 'beat-1',
        type: 'beat',
        title: '关键转折',
        summary: '',
        order: 0,
        chapterId: 'chapter-1',
        referenceIds: ['role-ref-1'],
      },
    ],
    assets: [
      {
        id: 'event-1',
        type: 'event',
        refId: 'event-1',
        label: '进入遗迹',
        parentId: 'beat-1',
      },
      {
        id: 'mystery-1',
        type: 'mystery',
        refId: 'mystery-1',
        label: '幕级谜团',
        parentId: 'arc-1',
      },
      {
        id: 'unresolved-1',
        type: 'storyline',
        refId: 'unresolved-1',
        label: '失配故事线',
        parentId: 'missing-owner',
      },
      {
        id: 'role-ref-1',
        type: 'role',
        refId: 'role-1',
        label: '林默',
      },
    ],
  };
}

function createArcRemovalFixture() {
  const base = createNarrativeDocument({ title: '三幕故事' });
  const templateArc = base.arcs[0]!;
  const templateChapter = base.chapters[0]!;
  const arcs = [
    {
      ...templateArc,
      id: 'arc-first',
      order: 0,
      chapterIds: ['chapter-first'],
    },
    {
      ...templateArc,
      id: 'arc-middle',
      order: 1,
      chapterIds: ['chapter-middle-a', 'chapter-middle-b'],
    },
    { ...templateArc, id: 'arc-last', order: 2, chapterIds: ['chapter-last'] },
  ];
  const chapters = [
    { ...templateChapter, id: 'chapter-first', arcId: 'arc-first', order: 0 },
    {
      ...templateChapter,
      id: 'chapter-middle-a',
      arcId: 'arc-middle',
      order: 0,
      beatIds: ['beat-middle'],
    },
    {
      ...templateChapter,
      id: 'chapter-middle-b',
      arcId: 'arc-middle',
      order: 1,
    },
    { ...templateChapter, id: 'chapter-last', arcId: 'arc-last', order: 0 },
  ];
  const document = normalizeNarrativeDocument({
    ...base,
    arcs,
    chapters,
    canvases: {},
  });
  document.canvases['chapter-middle-a']!.nodes.push({
    id: 'beat-middle',
    type: 'beat',
    title: '关键转折',
    summary: '',
    order: 0,
    chapterId: 'chapter-middle-a',
    referenceIds: [],
  });
  return document;
}
