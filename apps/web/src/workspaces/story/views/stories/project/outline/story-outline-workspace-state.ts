import type {
  OutlinePosition,
  OutlinePositionMap,
  OutlineView,
} from './story-outline-types';

export type OutlineOwnerActivationState = {
  activeOwnerId: string;
  selectedId: string | null;
  focusRequest: { nodeId: string; sequence: number } | null;
  materialPreviewRequest: { type: string; parentId: string } | null;
  activationSequence: number;
};

export type CanvasPositionState = {
  positionsByView: Partial<Record<OutlineView, OutlinePositionMap>>;
};

export function activateOutlineOwner(
  state: OutlineOwnerActivationState,
  ownerId: string,
): OutlineOwnerActivationState {
  if (ownerId === state.activeOwnerId) return state;

  return {
    activeOwnerId: ownerId,
    selectedId: ownerId,
    focusRequest: null,
    materialPreviewRequest: null,
    activationSequence: state.activationSequence + 1,
  };
}

export function readCanvasPositions(
  canvases: Record<string, CanvasPositionState>,
  ownerId: string,
  view: OutlineView,
): OutlinePositionMap {
  return canvases[ownerId]?.positionsByView[view] ?? {};
}

export function writeCanvasPosition(
  canvases: Record<string, CanvasPositionState>,
  ownerId: string,
  view: OutlineView,
  nodeId: string,
  position: OutlinePosition,
): boolean {
  const canvas = canvases[ownerId];
  if (!canvas) return false;

  const positions = canvas.positionsByView[view] ?? {};
  canvas.positionsByView[view] = {
    ...positions,
    [nodeId]: position,
  };
  return true;
}

export function clearCanvasPositions(
  canvases: Record<string, CanvasPositionState>,
  ownerId: string,
  view: OutlineView,
): boolean {
  const canvas = canvases[ownerId];
  if (!canvas || canvas.positionsByView[view] === undefined) return false;

  delete canvas.positionsByView[view];
  return true;
}
