import { describe, expect, it } from 'vitest';

import { getSmartSnapPosition } from './story-outline-snap';

const moving = { id: 'moving', x: 100, y: 100, width: 100, height: 80 };
const target = { id: 'target', x: 220, y: 220, width: 100, height: 80 };

describe('story outline smart snap', () => {
  it('snaps the moving right edge to the target left edge', () => {
    const result = getSmartSnapPosition({ ...moving, x: 118 }, [target]);

    expect(result.position.x).toBe(120);
    expect(result.matches.x?.sourceAnchor).toBe('end');
    expect(result.matches.x?.targetAnchor).toBe('start');
    expect(result.guides).toEqual([
      {
        orientation: 'vertical',
        position: 220,
        start: 100,
        end: 300,
      },
    ]);
  });

  it('snaps horizontal and vertical alignments at the same time', () => {
    const result = getSmartSnapPosition({ ...moving, x: 121, y: 138 }, [
      { ...target, x: 220, y: 220 },
    ]);

    expect(result.position).toEqual({ x: 120, y: 140 });
    expect(result.guides).toHaveLength(2);
    expect(result.guides.map((guide) => guide.orientation)).toEqual([
      'vertical',
      'horizontal',
    ]);
  });

  it('does not snap when every alignment is outside the threshold', () => {
    const result = getSmartSnapPosition({ ...moving, x: 110, y: 110 }, [
      target,
    ]);

    expect(result.position).toEqual({ x: 110, y: 110 });
    expect(result.matches).toEqual({ x: undefined, y: undefined });
    expect(result.guides).toEqual([]);
  });

  it('keeps an active match until the larger release threshold is exceeded', () => {
    const first = getSmartSnapPosition({ ...moving, x: 118 }, [target]);
    const held = getSmartSnapPosition(
      { ...moving, x: 111 },
      [target],
      first.matches,
    );
    const released = getSmartSnapPosition(
      { ...moving, x: 106 },
      [target],
      first.matches,
    );

    expect(held.position.x).toBe(120);
    expect(held.matches.x).toEqual(first.matches.x);
    expect(released.position.x).toBe(106);
    expect(released.matches.x).toBeUndefined();
  });
});
