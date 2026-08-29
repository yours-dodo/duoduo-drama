import { describe, expect, it } from 'vitest';

import {
  activateOutlineOwner,
  clearCanvasPositions,
  readCanvasPositions,
  writeCanvasPosition,
  type CanvasPositionState,
  type OutlineOwnerActivationState,
} from './story-outline-workspace-state';

describe('outline owner activation', () => {
  it('switches owners and clears canvas-local interaction state', () => {
    const state: OutlineOwnerActivationState = {
      activeOwnerId: 'story-1',
      selectedId: 'event-1',
      focusRequest: { nodeId: 'event-1', sequence: 3 },
      materialPreviewRequest: { type: 'event', parentId: 'event-1' },
      activationSequence: 4,
    };

    expect(activateOutlineOwner(state, 'chapter-1')).toEqual({
      activeOwnerId: 'chapter-1',
      selectedId: 'chapter-1',
      focusRequest: null,
      materialPreviewRequest: null,
      activationSequence: 5,
    });
    expect(state.activeOwnerId).toBe('story-1');
  });

  it('does not mutate state or remount for a repeated owner selection', () => {
    const state: OutlineOwnerActivationState = {
      activeOwnerId: 'story-1',
      selectedId: 'story-1',
      focusRequest: null,
      materialPreviewRequest: null,
      activationSequence: 2,
    };

    expect(activateOutlineOwner(state, 'story-1')).toBe(state);
  });
});

describe('canvas-local positions', () => {
  it('writes and clears only the requested owner and view', () => {
    const canvases: Record<string, CanvasPositionState> = {
      'story-1': {
        positionsByView: {
          'timeline-vertical': { 'story-1': { x: 10, y: 20 } },
        },
      },
      'chapter-1': {
        positionsByView: {
          'timeline-horizontal': { 'chapter-1': { x: 30, y: 40 } },
        },
      },
    };

    expect(
      writeCanvasPosition(
        canvases,
        'story-1',
        'timeline-horizontal',
        'event-1',
        { x: 50, y: 60 },
      ),
    ).toBe(true);
    expect(
      readCanvasPositions(canvases, 'story-1', 'timeline-horizontal'),
    ).toEqual({ 'event-1': { x: 50, y: 60 } });
    expect(
      readCanvasPositions(canvases, 'story-1', 'timeline-vertical'),
    ).toEqual({ 'story-1': { x: 10, y: 20 } });
    expect(
      readCanvasPositions(canvases, 'chapter-1', 'timeline-horizontal'),
    ).toEqual({ 'chapter-1': { x: 30, y: 40 } });

    expect(
      clearCanvasPositions(canvases, 'story-1', 'timeline-horizontal'),
    ).toBe(true);
    expect(
      readCanvasPositions(canvases, 'story-1', 'timeline-horizontal'),
    ).toEqual({});
    expect(
      readCanvasPositions(canvases, 'chapter-1', 'timeline-horizontal'),
    ).toEqual({ 'chapter-1': { x: 30, y: 40 } });
  });

  it('refuses to create positions for a missing owner canvas', () => {
    const canvases: Record<string, CanvasPositionState> = {};

    expect(
      writeCanvasPosition(
        canvases,
        'missing',
        'timeline-horizontal',
        'event-1',
        { x: 10, y: 20 },
      ),
    ).toBe(false);
    expect(
      clearCanvasPositions(canvases, 'missing', 'timeline-horizontal'),
    ).toBe(false);
  });
});
