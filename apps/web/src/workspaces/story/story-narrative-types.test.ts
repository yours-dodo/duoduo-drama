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
} from './story-narrative-types';

describe('narrative document adapter', () => {
  it('creates a valid story, arc, and chapter skeleton', () => {
    const document = createNarrativeDocument({ title: '  夜航船  ' });

    expect(document.schemaVersion).toBe(NARRATIVE_DOCUMENT_SCHEMA_VERSION);
    expect(document.story.title).toBe('夜航船');
    expect(document.story.arcIds).toEqual([document.arcs[0]?.id]);
    expect(document.arcs[0]?.chapterIds).toEqual([document.chapters[0]?.id]);
    expect(document.chapters[0]?.arcId).toBe(document.arcs[0]?.id);
  });

  it('normalizes order and derives relationship indexes without sharing arrays', () => {
    const original = createNarrativeDocument({ title: '故事' });
    const normalized = normalizeNarrativeDocument({
      ...original,
      arcs: [{ ...original.arcs[0], order: 4, chapterIds: ['stale'] }],
      chapters: [
        { ...original.chapters[0], order: 2, beatIds: [], referenceIds: [] },
      ],
    });

    expect(normalized.story.arcIds).toEqual([normalized.arcs[0]?.id]);
    expect(normalized.arcs[0]?.chapterIds).toEqual([
      normalized.chapters[0]?.id,
    ]);
    expect(normalized.arcs).not.toBe(original.arcs);
    expect(normalized.chapters).not.toBe(original.chapters);
  });

  it('migrates legacy outline trees without dropping descendants', () => {
    const result = parseNarrativeDocument(JSON.stringify(createOutlineSeed()), {
      title: '迁移故事',
    });

    expect(result.source).toBe('legacy-outline');
    expect(result.migrated).toBe(true);
    expect(result.document.story.title).toBe('一封未寄出的信');
    expect(result.document.arcs.length).toBeGreaterThan(0);
    expect(result.document.chapters.length).toBeGreaterThanOrEqual(
      result.document.arcs.length,
    );
    expect(result.document.beats.map((beat) => beat.title)).toEqual(
      expect.arrayContaining(['林遥', '被掩埋的真相', '周砚']),
    );
    expect(result.document.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          refId: 'outline-lin',
          type: 'role',
          legacy: true,
        }),
        expect.objectContaining({
          refId: 'outline-zhou',
          type: 'role',
          legacy: true,
        }),
      ]),
    );
  });

  it('round-trips normalized hierarchy into the VueFlow document boundary', () => {
    const document = createNarrativeDocument({ title: '边界测试' });
    const outline = narrativeDocumentToOutline(document);

    expect(outline.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        document.story.id,
        document.arcs[0]?.id,
        document.chapters[0]?.id,
      ]),
    );
    expect(outline.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: document.story.id,
          target: document.arcs[0]?.id,
        }),
        expect.objectContaining({
          source: document.arcs[0]?.id,
          target: document.chapters[0]?.id,
        }),
      ]),
    );
  });

  it('maps internal narrative materials to relation branches without exposing external references', () => {
    const document = createNarrativeDocument({ title: '物料测试' });
    document.assets.push(
      {
        id: 'event-1',
        type: 'event',
        refId: 'event-1',
        label: '进入遗迹',
        relation: '建立危险感',
      },
      {
        id: 'role-ref-1',
        type: 'role',
        refId: 'role-1',
        label: '林默',
      },
    );

    const outline = narrativeDocumentToOutline(document);

    expect(outline.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'event-1',
          parentId: document.story.id,
          title: '进入遗迹',
          summary: '建立危险感',
          type: 'event',
          lane: '剧情资产',
        }),
      ]),
    );
    expect(outline.nodes.some((node) => node.id === 'role-ref-1')).toBe(false);
    expect(outline.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: document.story.id,
          target: 'event-1',
          kind: 'relation',
          label: '事件',
        }),
      ]),
    );
  });

  it('maps a narrative material to the structural node it was dropped on', () => {
    const document = createNarrativeDocument({ title: '定点物料测试' });
    const chapterId = document.chapters[0]!.id;
    const asset = {
      id: 'event-on-chapter',
      type: 'event' as const,
      refId: 'event-on-chapter',
      label: '章节转折',
      relation: '挂到第一章',
      parentId: chapterId,
    };
    document.assets.push(asset);

    const outline = narrativeDocumentToOutline(document);

    expect(outline.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: asset.id,
          parentId: chapterId,
        }),
      ]),
    );
    expect(outline.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: chapterId,
          target: asset.id,
          kind: 'relation',
        }),
      ]),
    );
  });

  it('falls back to the story when a material parent is not structural', () => {
    const document = createNarrativeDocument({ title: '无效物料父级' });
    document.assets.push(
      {
        id: 'event-parent',
        type: 'event',
        refId: 'event-parent',
        label: '已有事件',
      },
      {
        id: 'event-child',
        type: 'event',
        refId: 'event-child',
        label: '错误子事件',
        parentId: 'event-parent',
      },
    );

    const outline = narrativeDocumentToOutline(document);

    expect(
      outline.nodes.find((node) => node.id === 'event-child')?.parentId,
    ).toBe(document.story.id);
    expect(
      outline.edges.find((edge) => edge.target === 'event-child')?.source,
    ).toBe(document.story.id);
  });
});

describe('removeNarrativeArc', () => {
  it('moves chapters from a middle arc to the previous arc and keeps beats', () => {
    const document = createArcRemovalFixture();

    const result = removeNarrativeArc(document, 'arc-middle');

    expect(result.removed).toBe(true);
    expect(result.targetArcId).toBe('arc-first');
    expect(result.migratedChapterIds).toEqual([
      'chapter-middle-a',
      'chapter-middle-b',
    ]);
    expect(result.document.story.arcIds).toEqual(['arc-first', 'arc-last']);
    expect(result.document.arcs.map((arc) => arc.order)).toEqual([0, 1]);
    expect(result.document.arcs[0]?.chapterIds).toEqual([
      'chapter-first',
      'chapter-middle-a',
      'chapter-middle-b',
    ]);
    expect(
      result.document.chapters
        .filter((chapter) => chapter.arcId === 'arc-first')
        .map((chapter) => ({ id: chapter.id, order: chapter.order })),
    ).toEqual([
      { id: 'chapter-first', order: 0 },
      { id: 'chapter-middle-a', order: 1 },
      { id: 'chapter-middle-b', order: 2 },
    ]);
    expect(result.document.beats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'beat-middle',
          chapterId: 'chapter-middle-a',
        }),
      ]),
    );
    expect(document.arcs.map((arc) => arc.id)).toContain('arc-middle');
  });

  it('moves chapters from the first arc to the next arc', () => {
    const result = removeNarrativeArc(createArcRemovalFixture(), 'arc-first');

    expect(result.removed).toBe(true);
    expect(result.targetArcId).toBe('arc-middle');
    expect(
      result.document.chapters
        .filter((chapter) => chapter.arcId === 'arc-middle')
        .map((chapter) => chapter.id),
    ).toEqual(['chapter-middle-a', 'chapter-middle-b', 'chapter-first']);
  });

  it('moves chapters from the last arc to the previous arc', () => {
    const result = removeNarrativeArc(createArcRemovalFixture(), 'arc-last');

    expect(result.removed).toBe(true);
    expect(result.targetArcId).toBe('arc-middle');
    expect(
      result.document.chapters
        .filter((chapter) => chapter.arcId === 'arc-middle')
        .map((chapter) => chapter.id),
    ).toEqual(['chapter-middle-a', 'chapter-middle-b', 'chapter-last']);
  });

  it('removes an empty arc without changing chapters', () => {
    const document = createArcRemovalFixture();
    document.chapters = document.chapters.filter(
      (chapter) => chapter.arcId !== 'arc-middle',
    );
    const chapterIds = document.chapters.map((chapter) => chapter.id);

    const result = removeNarrativeArc(document, 'arc-middle');

    expect(result.removed).toBe(true);
    expect(result.targetArcId).toBe('arc-first');
    expect(result.migratedChapterIds).toEqual([]);
    expect(result.document.chapters.map((chapter) => chapter.id)).toEqual(
      chapterIds,
    );
  });

  it('does not remove the only remaining arc', () => {
    const document = createNarrativeDocument({ title: '单幕故事' });

    const result = removeNarrativeArc(document, document.arcs[0]!.id);

    expect(result).toEqual({
      document,
      removed: false,
      targetArcId: null,
      migratedChapterIds: [],
      reason: 'last-arc',
    });
  });

  it('does not change the document when the arc does not exist', () => {
    const document = createArcRemovalFixture();

    const result = removeNarrativeArc(document, 'missing-arc');

    expect(result).toEqual({
      document,
      removed: false,
      targetArcId: null,
      migratedChapterIds: [],
      reason: 'arc-not-found',
    });
  });
});

describe('removeNarrativeChapter', () => {
  it('deletes a chapter with its beats and reorders the remaining chapters', () => {
    const document = createArcRemovalFixture();

    const result = removeNarrativeChapter(document, 'chapter-middle-a');

    expect(result.removed).toBe(true);
    expect(result.parentArcId).toBe('arc-middle');
    expect(result.removedBeatIds).toEqual(['beat-middle']);
    expect(
      result.document.chapters.some(
        (chapter) => chapter.id === 'chapter-middle-a',
      ),
    ).toBe(false);
    expect(
      result.document.beats.some((beat) => beat.id === 'beat-middle'),
    ).toBe(false);
    expect(
      result.document.chapters
        .filter((chapter) => chapter.arcId === 'arc-middle')
        .map((chapter) => ({ id: chapter.id, order: chapter.order })),
    ).toEqual([{ id: 'chapter-middle-b', order: 0 }]);
    expect(
      result.document.arcs.find((arc) => arc.id === 'arc-middle')?.chapterIds,
    ).toEqual(['chapter-middle-b']);
    expect(document.chapters.map((chapter) => chapter.id)).toContain(
      'chapter-middle-a',
    );
  });

  it('deletes a chapter without beats', () => {
    const result = removeNarrativeChapter(
      createArcRemovalFixture(),
      'chapter-middle-b',
    );

    expect(result.removed).toBe(true);
    expect(result.parentArcId).toBe('arc-middle');
    expect(result.removedBeatIds).toEqual([]);
    expect(
      result.document.arcs.find((arc) => arc.id === 'arc-middle')?.chapterIds,
    ).toEqual(['chapter-middle-a']);
  });

  it('allows deleting the last chapter and leaves an empty arc', () => {
    const result = removeNarrativeChapter(
      createArcRemovalFixture(),
      'chapter-last',
    );

    expect(result.removed).toBe(true);
    expect(result.parentArcId).toBe('arc-last');
    expect(
      result.document.arcs.find((arc) => arc.id === 'arc-last')?.chapterIds,
    ).toEqual([]);
    expect(
      result.document.chapters.some((chapter) => chapter.arcId === 'arc-last'),
    ).toBe(false);
  });

  it('does not change the document when the chapter does not exist', () => {
    const document = createArcRemovalFixture();

    const result = removeNarrativeChapter(document, 'missing-chapter');

    expect(result).toEqual({
      document,
      removed: false,
      parentArcId: null,
      removedBeatIds: [],
      reason: 'chapter-not-found',
    });
  });
});

function createArcRemovalFixture() {
  const document = createNarrativeDocument({ title: '三幕故事' });
  const templateArc = document.arcs[0]!;
  const templateChapter = document.chapters[0]!;
  const firstArc = {
    ...templateArc,
    id: 'arc-first',
    title: '第一幕',
    order: 0,
    chapterIds: ['chapter-first'],
  };
  const middleArc = {
    ...templateArc,
    id: 'arc-middle',
    title: '第二幕',
    order: 1,
    chapterIds: ['chapter-middle-a', 'chapter-middle-b'],
  };
  const lastArc = {
    ...templateArc,
    id: 'arc-last',
    title: '第三幕',
    order: 2,
    chapterIds: ['chapter-last'],
  };
  const firstChapter = {
    ...templateChapter,
    id: 'chapter-first',
    title: '第一章',
    arcId: firstArc.id,
    order: 0,
    beatIds: [],
  };
  const middleChapterA = {
    ...templateChapter,
    id: 'chapter-middle-a',
    title: '第二章',
    arcId: middleArc.id,
    order: 0,
    beatIds: ['beat-middle'],
  };
  const middleChapterB = {
    ...templateChapter,
    id: 'chapter-middle-b',
    title: '第三章',
    arcId: middleArc.id,
    order: 1,
    beatIds: [],
  };
  const lastChapter = {
    ...templateChapter,
    id: 'chapter-last',
    title: '第四章',
    arcId: lastArc.id,
    order: 0,
    beatIds: [],
  };

  return normalizeNarrativeDocument({
    ...document,
    arcs: [firstArc, middleArc, lastArc],
    chapters: [firstChapter, middleChapterA, middleChapterB, lastChapter],
    beats: [
      {
        id: 'beat-middle',
        type: 'beat',
        title: '关键转折',
        summary: '',
        order: 0,
        chapterId: middleChapterA.id,
        referenceIds: [],
      },
    ],
  });
}
