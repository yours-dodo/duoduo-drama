export type OutlineMode = 'timeline' | 'organization';

export type OutlineView =
  | 'timeline-horizontal'
  | 'timeline-vertical'
  | 'timeline-fishbone'
  | 'organization-logic'
  | 'organization-mindmap';

export type OutlineNodeType = 'event' | 'character' | 'conflict' | 'chapter';

export type OutlinePosition = {
  x: number;
  y: number;
};

export type OutlineNode = {
  id: string;
  title: string;
  summary: string;
  type: OutlineNodeType;
  parentId?: string;
  order: number;
  lane?: string;
};

export type OutlineEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type PositionedOutlineNode = OutlineNode & OutlinePosition;

export type OutlinePositionMap = Record<string, OutlinePosition>;

export type OutlineLayout = {
  width: number;
  height: number;
  nodes: PositionedOutlineNode[];
};

export const OUTLINE_NODE_WIDTH = 220;
export const OUTLINE_NODE_HEIGHT = 112;

export const OUTLINE_NODE_TYPE_LABELS: Record<OutlineNodeType, string> = {
  event: '事件',
  character: '角色',
  conflict: '冲突',
  chapter: '章节',
};

export const OUTLINE_VIEW_LABELS: Record<OutlineView, string> = {
  'timeline-horizontal': '横轴',
  'timeline-vertical': '纵轴',
  'timeline-fishbone': '鱼骨图',
  'organization-logic': '逻辑图',
  'organization-mindmap': '思维导图',
};
