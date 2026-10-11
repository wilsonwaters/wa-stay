import underlineSvg from '../../assets/brush/underline.svg?raw';
import dabSvg from '../../assets/brush/dab.svg?raw';
import swashSvg from '../../assets/brush/swash.svg?raw';

/**
 * The WA Stay brushstroke: an original hand-drawn mark, used sparingly as decoration.
 *
 * Rules (docs/design/design-language.md, "Brushstroke motif"):
 * - only in ocean-500, ocean-100, sun-400 or sun-100 (the `tone` prop allows nothing else);
 * - active nav underline, logo, photo-placeholder dab and EmptyState accent only;
 * - never behind body text or as a button fill, and at most one per region.
 */
export type BrushstrokeVariant = 'underline' | 'dab' | 'swash';
export type BrushstrokeTone = 'ocean' | 'ocean-soft' | 'sun' | 'sun-soft';

export interface BrushstrokeProps {
  variant: BrushstrokeVariant;
  tone?: BrushstrokeTone;
  /** Sizes the stroke. It stretches to the box, so give it a width and a height. */
  className?: string;
}

interface BrushGeometry {
  viewBox: string;
  paths: string[];
}

/** Reads the viewBox and path data from one of the brush SVG files. */
function readBrush(svg: string): BrushGeometry {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 1 1';
  const paths = Array.from(svg.matchAll(/<path[^>]*\sd="([^"]+)"/g), (m) => m[1]);
  return { viewBox, paths };
}

const BRUSHES: Record<BrushstrokeVariant, BrushGeometry> = {
  underline: readBrush(underlineSvg),
  dab: readBrush(dabSvg),
  swash: readBrush(swashSvg),
};

/**
 * Where each stroke's paint is, on average (the centroid of its filled area), as fractions of
 * its box. Measured by `node scripts/brand/brushstrokes.js`; a test keeps them in step.
 * Use it to sit something on the paint rather than on the box centre.
 */
export const BRUSH_MASS_CENTRE: Record<BrushstrokeVariant, { x: number; y: number }> = {
  underline: { x: 0.435, y: 0.462 },
  dab: { x: 0.459, y: 0.46 },
  swash: { x: 0.43, y: 0.571 },
};

/** The only palette tokens a brushstroke may be painted in. */
export const BRUSH_TONE_TOKENS: Record<BrushstrokeTone, string> = {
  ocean: 'ocean-500',
  'ocean-soft': 'ocean-100',
  sun: 'sun-400',
  'sun-soft': 'sun-100',
};

export function Brushstroke({ variant, tone = 'ocean', className }: BrushstrokeProps) {
  const { viewBox, paths } = BRUSHES[variant];
  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ color: `rgb(var(--ws-${BRUSH_TONE_TOKENS[tone]}))`, display: 'block' }}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

export default Brushstroke;
