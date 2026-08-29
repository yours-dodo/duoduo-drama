import { describe, expect, it } from 'vitest';

import { StoryOutlineContentInvalidError } from './story-errors.js';
import { validateStoryOutlineContent } from './story-outline-content.js';

function createValidV2Document() {
  return {
    schemaVersion: 'narrative-planning.v2',
    rootStoryId: 'story-1',
    story: {
      id: 'story-1',
      type: 'story',
      title: '故事',
      summary: '',
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
    canvases: {
      'story-1': {
        nodes: [],
        edges: [],
        references: [],
        positionsByView: {},
      },
      'arc-1': {
        nodes: [],
        edges: [],
        references: [],
        positionsByView: {},
      },
      'chapter-1': {
        nodes: [
          {
            id: 'beat-1',
            type: 'beat',
            title: '开场',
            summary: '',
            order: 0,
            parentId: 'chapter-1',
            chapterId: 'chapter-1',
            referenceIds: [],
          },
        ],
        edges: [
          {
            id: 'edge-1',
            source: 'chapter-1',
            target: 'beat-1',
            kind: 'sequence',
          },
        ],
        references: [
          {
            id: 'reference-1',
            type: 'role',
            refId: 'role-1',
            label: '主角',
            parentId: 'beat-1',
          },
        ],
        positionsByView: {
          'timeline-horizontal': {
            'beat-1': { x: 120, y: 80 },
          },
        },
      },
    },
  };
}

function expectInvalid(document: unknown) {
  expect(() => validateStoryOutlineContent(JSON.stringify(document))).toThrow(
    StoryOutlineContentInvalidError,
  );
}

describe('validateStoryOutlineContent', () => {
  it('accepts v1 compatibility documents and complete independent v2 canvases', () => {
    expect(() =>
      validateStoryOutlineContent(
        JSON.stringify({
          schemaVersion: 'narrative-planning.v1',
          rootStoryId: 'story-1',
          story: {
            id: 'story-1',
            type: 'story',
            title: '故事',
            summary: '',
            arcIds: [],
          },
          arcs: [],
          chapters: [],
          beats: [],
          assets: [],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateStoryOutlineContent(JSON.stringify(createValidV2Document())),
    ).not.toThrow();

    const positionedOwner = createValidV2Document();
    positionedOwner.canvases['story-1']!.positionsByView = {
      'timeline-horizontal': { 'story-1': { x: 40, y: 60 } },
    };
    expect(() =>
      validateStoryOutlineContent(JSON.stringify(positionedOwner)),
    ).not.toThrow();
  });

  it('requires canvases to cover every structural owner exactly', () => {
    const missing = createValidV2Document();
    delete missing.canvases['arc-1'];
    expectInvalid(missing);

    const orphan = createValidV2Document();
    orphan.canvases['orphan-1'] = {
      nodes: [],
      edges: [],
      references: [],
      positionsByView: {},
    };
    expectInvalid(orphan);
  });

  it('rejects duplicate structural or globally duplicated canvas node ids', () => {
    const duplicateStructure = createValidV2Document();
    duplicateStructure.chapters[0]!.id = 'arc-1';
    expectInvalid(duplicateStructure);

    const duplicateNode = createValidV2Document();
    duplicateNode.canvases['story-1']!.nodes.push({
      id: 'beat-1',
      type: 'event',
      title: '重复',
      summary: '',
      order: 1,
    });
    expectInvalid(duplicateNode);
  });

  it('rejects cross-canvas edges, parents, and positions plus unsupported views', () => {
    const crossEdge = createValidV2Document();
    crossEdge.canvases['story-1']!.edges.push({
      id: 'edge-cross',
      source: 'story-1',
      target: 'beat-1',
      kind: 'relation',
    });
    expectInvalid(crossEdge);

    const crossParent = createValidV2Document();
    crossParent.canvases['story-1']!.nodes.push({
      id: 'story-node',
      type: 'event',
      title: '节点',
      summary: '',
      order: 0,
      parentId: 'beat-1',
    });
    expectInvalid(crossParent);

    const crossPosition = createValidV2Document();
    crossPosition.canvases['story-1']!.positionsByView = {
      'timeline-horizontal': { 'beat-1': { x: 0, y: 0 } },
    };
    expectInvalid(crossPosition);

    const unsupportedView = createValidV2Document();
    unsupportedView.canvases['story-1']!.positionsByView = {
      'timeline-radial': {},
    };
    expectInvalid(unsupportedView);
  });

  it('requires root, arc, chapter, and beat indexes to match structure', () => {
    const invalidRoot = createValidV2Document();
    invalidRoot.rootStoryId = 'story-other';
    expectInvalid(invalidRoot);

    const invalidArcIndex = createValidV2Document();
    invalidArcIndex.story.arcIds = [];
    expectInvalid(invalidArcIndex);

    const invalidChapterIndex = createValidV2Document();
    invalidChapterIndex.arcs[0]!.chapterIds = [];
    expectInvalid(invalidChapterIndex);

    const invalidBeatIndex = createValidV2Document();
    invalidBeatIndex.chapters[0]!.beatIds = ['missing-beat'];
    expectInvalid(invalidBeatIndex);

    const unindexedBeat = createValidV2Document();
    unindexedBeat.canvases['chapter-1']!.nodes.push({
      id: 'beat-2',
      type: 'beat',
      title: '未索引 Beat',
      summary: '',
      order: 1,
      chapterId: 'chapter-1',
      referenceIds: [],
    });
    expectInvalid(unindexedBeat);

    const crossChapterBeat = createValidV2Document();
    crossChapterBeat.canvases['chapter-1']!.nodes[0]!.chapterId =
      'chapter-other';
    expectInvalid(crossChapterBeat);
  });

  it('requires every beat field consumed by the Web v2 decoder', () => {
    const missingReferenceIds = createValidV2Document();
    delete missingReferenceIds.canvases['chapter-1']!.nodes[0]!.referenceIds;

    expectInvalid(missingReferenceIds);
  });
});
