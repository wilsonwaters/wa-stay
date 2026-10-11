import { computePosition } from './position';

const viewport = { width: 960, height: 640 };
const floating = { width: 300, height: 200 };

describe('computePosition', () => {
  it('places the layer below its anchor, start-aligned, with the offset', () => {
    const p = computePosition({
      anchor: { top: 100, left: 50, width: 120, height: 40 },
      floating,
      viewport,
    });
    expect(p).toEqual({ top: 148, left: 50, side: 'bottom', available: 484 });
  });

  it('flips above when there is no room below and more room above', () => {
    const p = computePosition({
      anchor: { top: 520, left: 50, width: 120, height: 40 },
      floating,
      viewport,
    });
    expect(p.side).toBe('top');
    expect(p.top).toBe(520 - 8 - 200);
  });

  it('stays below when neither side fits but below has more room, and clamps to the viewport', () => {
    const p = computePosition({
      anchor: { top: 200, left: 50, width: 120, height: 40 },
      floating: { width: 300, height: 600 },
      viewport,
    });
    expect(p.side).toBe('bottom');
    expect(p.top).toBe(640 - 8 - 600);
  });

  it('flips a top-preferring layer below when the top has no room', () => {
    const p = computePosition({
      anchor: { top: 10, left: 50, width: 120, height: 40 },
      floating: { width: 100, height: 30 },
      viewport,
      side: 'top',
    });
    expect(p.side).toBe('bottom');
    expect(p.top).toBe(58);
  });

  it('says how much height there is room for on the side it is placed', () => {
    const anchor = { top: 100, left: 50, width: 120, height: 40 };
    // Below: 640 − 140 − 8 (offset) − 8 (edge)
    expect(computePosition({ anchor, floating, viewport }).available).toBe(484);
    // Flipped above: 520 − 8 − 8
    expect(computePosition({ anchor: { ...anchor, top: 520 }, floating, viewport }).available).toBe(
      504
    );
    // No room on either side: 0, never a negative height
    expect(
      computePosition({
        anchor: { ...anchor, top: 0 },
        floating,
        viewport: { width: 960, height: 30 },
      }).available
    ).toBe(0);
  });

  it('clamps at the right edge so there is no horizontal scroll at 960 px', () => {
    const p = computePosition({
      anchor: { top: 100, left: 900, width: 40, height: 40 },
      floating,
      viewport,
    });
    expect(p.left).toBe(960 - 8 - 300);
    expect(p.left + floating.width).toBeLessThanOrEqual(viewport.width);
  });

  it('clamps at the left edge for end and centre alignment', () => {
    const anchor = { top: 100, left: 10, width: 40, height: 40 };
    expect(computePosition({ anchor, floating, viewport, align: 'end' }).left).toBe(8);
    expect(computePosition({ anchor, floating, viewport, align: 'center' }).left).toBe(8);
  });

  it('centres and end-aligns against the anchor when there is room', () => {
    const anchor = { top: 100, left: 400, width: 100, height: 40 };
    expect(computePosition({ anchor, floating, viewport, align: 'center' }).left).toBe(300);
    expect(computePosition({ anchor, floating, viewport, align: 'end' }).left).toBe(200);
  });

  it('pins a layer wider than the viewport to the left padding', () => {
    const p = computePosition({
      anchor: { top: 100, left: 400, width: 100, height: 40 },
      floating: { width: 2000, height: 100 },
      viewport,
    });
    expect(p.left).toBe(8);
  });
});
