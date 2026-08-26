import { describe, expect, it } from 'vitest';

import {
  createNarrativeMaterialPreviewDocument,
  NARRATIVE_MATERIAL_PREVIEW_EDGE_ID,
  NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
  projectNarrativeMaterialPreview,
} from './story-outline-material-preview';
import type { OutlineDocument } from './story-outline-layout';
import type { OutlineLayout } from './story-outline-types';

describe('outline material preview document', () => {
  it('adds one temporary material node and edge without mutating the source', () => {
    const source: OutlineDocument = {
      nodes: [
        {
          id: 'story',
          title: '故事',
          summary: '',
          type: 'chapter',
          order: 0,
        },
        {
          id: 'chapter',
          title: '第一章',
          summary: '',
          type: 'chapter',
          parentId: 'story',
          order: 1,
        },
      ],
      edges: [
        {
          id: 'story-chapter',
          source: 'story',
          target: 'chapter',
          kind: 'sequence',
        },
      ],
    };
    const before = structuredClone(source);

    const preview = createNarrativeMaterialPreviewDocument(source, {
      type: 'foreshadow',
      parentId: 'chapter',
    });

    expect(preview?.document.nodes).toHaveLength(3);
    expect(preview?.document.edges).toHaveLength(2);
    expect(preview?.document.nodes.at(-1)).toEqual(
      expect.objectContaining({
        id: NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
        parentId: 'chapter',
        type: 'foreshadow',
        title: '伏笔占位',
      }),
    );
    expect(preview?.document.edges.at(-1)).toEqual(
      expect.objectContaining({
        id: NARRATIVE_MATERIAL_PREVIEW_EDGE_ID,
        source: 'chapter',
        target: NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
        kind: 'relation',
      }),
    );
    expect(source).toEqual(before);
  });

  it('rejects a preview whose parent is not in the outline', () => {
    const source: OutlineDocument = { nodes: [], edges: [] };

    expect(
      createNarrativeMaterialPreviewDocument(source, {
        type: 'event',
        parentId: 'missing',
      }),
    ).toBeNull();
  });
});

describe('outline material preview projection', () => {
  it('anchors the preview node and route to the current parent position', () => {
    const currentLayout = createCurrentLayout();
    const previewLayout = createPreviewLayout();
    const before = structuredClone(previewLayout);

    const projection = projectNarrativeMaterialPreview(
      currentLayout,
      previewLayout,
      'chapter',
    );

    expect(projection?.node).toEqual(
      expect.objectContaining({
        id: NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
        x: 280,
        y: 170,
      }),
    );
    expect(projection?.route?.points).toEqual([
      { x: 210, y: 76 },
      { x: 250, y: 76 },
      { x: 250, y: 226 },
      { x: 280, y: 226 },
    ]);
    expect(projection?.route?.subpaths).toEqual([
      [
        { x: 210, y: 76 },
        { x: 250, y: 76 },
      ],
    ]);
    expect(projection?.sourcePort?.nodeId).toBe('chapter');
    expect(projection?.targetPort?.nodeId).toBe(
      NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
    );
    expect(previewLayout).toEqual(before);
  });

  it('returns a node-only projection when the preview layout has no route', () => {
    const previewLayout = createPreviewLayout();
    delete previewLayout.edgeRoutes;
    delete previewLayout.edgePorts;

    const projection = projectNarrativeMaterialPreview(
      createCurrentLayout(),
      previewLayout,
      'chapter',
    );

    expect(projection?.node).toEqual(
      expect.objectContaining({ x: 280, y: 170 }),
    );
    expect(projection?.route).toBeNull();
    expect(projection?.sourcePort).toBeNull();
    expect(projection?.targetPort).toBeNull();
  });

  it('rejects incomplete preview layouts', () => {
    const previewLayout = createPreviewLayout();
    previewLayout.nodes = previewLayout.nodes.filter(
      (node) => node.id !== NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
    );

    expect(
      projectNarrativeMaterialPreview(
        createCurrentLayout(),
        previewLayout,
        'chapter',
      ),
    ).toBeNull();
  });
});

function createCurrentLayout(): OutlineLayout {
  return {
    width: 800,
    height: 600,
    nodes: [
      {
        id: 'chapter',
        title: '第一章',
        summary: '',
        type: 'chapter',
        order: 0,
        x: 10,
        y: 20,
      },
    ],
  };
}

function createPreviewLayout(): OutlineLayout {
  return {
    width: 900,
    height: 700,
    nodes: [
      {
        id: 'chapter',
        title: '第一章',
        summary: '',
        type: 'chapter',
        order: 0,
        x: 30,
        y: 50,
      },
      {
        id: NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
        title: '事件占位',
        summary: '松手添加',
        type: 'event',
        parentId: 'chapter',
        order: 1,
        x: 300,
        y: 200,
      },
    ],
    edgeRoutes: [
      {
        edgeId: NARRATIVE_MATERIAL_PREVIEW_EDGE_ID,
        source: 'chapter',
        target: NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
        sourcePortId: 'preview-source',
        targetPortId: 'preview-target',
        kind: 'relation',
        points: [
          { x: 230, y: 106 },
          { x: 270, y: 106 },
          { x: 270, y: 256 },
          { x: 300, y: 256 },
        ],
        subpaths: [
          [
            { x: 230, y: 106 },
            { x: 270, y: 106 },
          ],
        ],
        labelPosition: { x: 270, y: 180 },
        crossings: [{ x: 270, y: 140, orientation: 'vertical' }],
      },
    ],
    edgePorts: {
      'preview-source': {
        id: 'preview-source',
        edgeId: NARRATIVE_MATERIAL_PREVIEW_EDGE_ID,
        nodeId: 'chapter',
        kind: 'source',
        side: 'east',
        offset: 0.5,
      },
      'preview-target': {
        id: 'preview-target',
        edgeId: NARRATIVE_MATERIAL_PREVIEW_EDGE_ID,
        nodeId: NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
        kind: 'target',
        side: 'west',
        offset: 0.5,
      },
    },
  };
}
