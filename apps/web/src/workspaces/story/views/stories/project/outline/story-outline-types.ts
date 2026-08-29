export type OutlineMode = 'timeline' | 'organization';

export type OutlineView =
  | 'timeline-horizontal'
  | 'timeline-vertical'
  | 'timeline-fishbone'
  | 'organization-logic'
  | 'organization-mindmap';

export type OutlineNodeType =
  | 'event'
  | 'foreshadow'
  | 'mystery'
  | 'storyline'
  | 'character'
  | 'conflict'
  | 'chapter';

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
  kind?: 'sequence' | 'relation';
};

export type OutlinePortSide = 'north' | 'east' | 'south' | 'west';

export type OutlineEdgePort = {
  id: string;
  edgeId: string;
  nodeId: string;
  kind: 'source' | 'target';
  side: OutlinePortSide;
  offset: number;
};

export type OutlineRoutePoint = {
  x: number;
  y: number;
};

export type OutlineRouteCrossing = OutlineRoutePoint & {
  orientation: 'horizontal' | 'vertical';
};

export type OutlineEdgeRoute = {
  edgeId: string;
  source: string;
  target: string;
  sourcePortId: string;
  targetPortId: string;
  label?: string;
  kind?: OutlineEdge['kind'];
  decorative?: boolean;
  hidden?: boolean;
  decorativeRole?: 'axis' | 'branch';
  cornerRadius?: number;
  points: OutlineRoutePoint[];
  subpaths?: OutlineRoutePoint[][];
  labelPosition?: OutlineRoutePoint;
  crossings?: OutlineRouteCrossing[];
};

export type PositionedOutlineNode = OutlineNode & OutlinePosition;

export type OutlinePositionMap = Record<string, OutlinePosition>;

export type OutlineLayout = {
  width: number;
  height: number;
  nodes: PositionedOutlineNode[];
  edgeRoutes?: OutlineEdgeRoute[];
  edgePorts?: Record<string, OutlineEdgePort>;
};

export const OUTLINE_NODE_WIDTH = 220;
export const OUTLINE_NODE_HEIGHT = 112;

export const OUTLINE_NODE_TYPE_LABELS: Record<OutlineNodeType, string> = {
  event: '事件',
  foreshadow: '伏笔',
  mystery: '谜团',
  storyline: '故事线',
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
