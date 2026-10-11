#!/usr/bin/env node
'use strict';

/**
 * WA Stay brushstroke generator.
 *
 * This is the source of the three original brush SVGs in src/renderer/assets/brush/
 * (underline, dab, swash), and the geometry B1 builds the logo from. The output is fully
 * deterministic: the same specs always produce byte-identical files, and a test
 * (tests/scripts/brushstrokes.test.ts) fails if the committed SVGs drift from this script.
 *
 * How one stroke is built (nothing is traced from an existing mark, brief O4):
 * 1. A centreline c(t) and half-width w(t), for t in [0, 1], describe one pull of a loaded brush.
 * 2. The width is split into `lanes` bristle bands with seeded, jittered boundaries. Each band is
 *    a closed ribbon offset along the normal. Its outer edges carry low-frequency noise, gaps
 *    open between bands towards the tail (`gapFrom`, `gapMax`: the dry-brush break-up), and
 *    each band tapers to its own ragged tip (`tipLen`, `tipShrink`).
 * 3. A "head" ellipse at t = `cap` is the rounded landing where the brush first touched down.
 * 4. Every outline is smoothed into cubic Béziers (closed Catmull-Rom), rounded to 0.1, and the
 *    whole drawing is cropped to its bounds plus a 1-unit margin.
 *
 * Usage:
 *   node scripts/brand/brushstrokes.js          Check the committed SVGs match; print geometry.
 *   node scripts/brand/brushstrokes.js --write  Regenerate the committed SVGs.
 *
 * To derive new artwork (for example the logo), add a spec, run with --write and review the
 * result in #/__design. Keep the rules in docs/design/design-language.md ("Brushstroke motif").
 */

const fs = require('fs');
const path = require('path');

const BRUSH_DIR = path.resolve(__dirname, '../../src/renderer/assets/brush');

const r1 = (n) => Math.round(n * 10) / 10;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Deterministic linear congruential generator, so a seed always gives the same stroke. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Three summed sines: a cheap, smooth wobble for bristle edges. */
function noise(t, seed) {
  return (
    0.5 * Math.sin(2 * Math.PI * 2.3 * t + seed) +
    0.32 * Math.sin(2 * Math.PI * 5.7 * t + seed * 1.7) +
    0.18 * Math.sin(2 * Math.PI * 12.1 * t + seed * 2.3)
  );
}

/** Closed Catmull-Rom spline through `pts`, as an SVG path of cubic Béziers. */
function smoothPath(pts) {
  const n = pts.length;
  const get = (i) => pts[(i + n) % n];
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const k = 1 / 6;
    const c1 = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2 = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    d += `C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d + 'Z';
}

/** Point and unit normal of the centreline at t. */
function frame(centre, t) {
  const [x, y] = centre(t);
  const [xa, ya] = centre(clamp(t + 0.002, 0, 1));
  const [xb, yb] = centre(clamp(t - 0.002, 0, 1));
  const nx = -(ya - yb);
  const ny = xa - xb;
  const l = Math.hypot(nx, ny) || 1;
  return { x, y, nx: nx / l, ny: ny / l };
}

/** Builds one stroke: the head ellipse first, then one closed outline per bristle lane. */
function brush(spec) {
  const { centre, width, lanes, seed, rough, cap = 0.05, gapMax, steps } = spec;
  const rand = rng(seed);
  const endMin = spec.endMin || 0.8;

  // Lane boundaries across the stroke, in [-1, 1].
  const cuts = [-1];
  for (let i = 1; i < lanes; i++) cuts.push(-1 + (2 * i) / lanes + (rand() - 0.5) * (1.2 / lanes));
  cuts.push(1);

  const paths = [];
  for (let k = 0; k < lanes; k++) {
    const outer = k === 0 || k === lanes - 1;
    const tEnd = outer ? 0.86 + rand() * 0.1 : endMin + rand() * (1 - endMin);
    const tGap = spec.gapFrom + rand() * (spec.gapSpread || 0.18);
    const tipLen = (spec.tipLen || 0.1) + rand() * 0.08;
    const sA = rand() * 10;
    const sB = rand() * 10;
    const rand0 = rand();
    const top = [];
    const bot = [];
    const N = Math.max(10, Math.round(steps * tEnd));
    for (let i = 0; i <= N; i++) {
      const t = cap + ((tEnd - cap) * i) / N;
      const f = frame(centre, t);
      const w = width(t);
      const g = gapMax * smooth(tGap, 1, t);
      let a = cuts[k];
      let b = cuts[k + 1];
      const ov = 0.06;
      // Inner edges overlap slightly near the head, then open into gaps towards the tail.
      a = k === 0 ? a : a - ov + g;
      b = k === lanes - 1 ? b : b + ov - g;
      if (b < a) {
        const m = (a + b) / 2;
        a = m - 0.005;
        b = m + 0.005;
      }
      // Each lane tapers to a ragged point around its own centre.
      const u = smooth(tEnd - tipLen, tEnd, t);
      const mid = (a + b) / 2;
      const shrink = 1 - u * (spec.tipShrink * (0.75 + rand0 * 0.25));
      a = mid + (a - mid) * shrink;
      b = mid + (b - mid) * shrink;
      const damp = smooth(cap, cap + 0.22, t);
      const ea = damp * (k === 0 ? rough : rough * 0.35) * noise(t, sA);
      const eb = damp * (k === lanes - 1 ? rough : rough * 0.35) * noise(t, sB);
      const oa = a * w + ea;
      const ob = b * w + eb;
      top.push([f.x + f.nx * oa, f.y + f.ny * oa]);
      bot.push([f.x + f.nx * ob, f.y + f.ny * ob]);
    }
    paths.push(smoothPath([...top, ...bot.reverse()]));
  }

  // The head: an irregular ellipse overlapping the lane starts. Its back half carries the noise.
  const head = [];
  const H = 14;
  const f0 = frame(centre, cap);
  const w0 = width(cap);
  const len = spec.headLen;
  const tx = -f0.ny; // tangent, pointing back along the stroke
  const ty = f0.nx;
  for (let i = 0; i < 2 * H; i++) {
    const th = (Math.PI * i) / H;
    const back = Math.cos(th) > 0;
    const rr = back ? 1 + (spec.headRough || 0.06) * noise(i / (2 * H), seed) : 1;
    const along = Math.cos(th) * len * rr;
    const across = Math.sin(th) * w0 * 0.97 * rr;
    head.push([f0.x + tx * along + f0.nx * across, f0.y + ty * along + f0.ny * across]);
  }
  paths.unshift(smoothPath(head));
  return paths;
}

/** Path numbers as [x, y] pairs. Paths are only ever `M x y (C x y x y x y)* Z`. */
function pathNumbers(d) {
  return (d.match(/-?\d*\.?\d+/g) || []).map(Number);
}

/** Crops the drawing to its bounds plus a 1-unit margin, keeping a whole-number viewBox. */
function crop(paths) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of paths) {
    const nums = pathNumbers(d);
    for (let i = 0; i < nums.length; i += 2) {
      minX = Math.min(minX, nums[i]);
      maxX = Math.max(maxX, nums[i]);
      minY = Math.min(minY, nums[i + 1]);
      maxY = Math.max(maxY, nums[i + 1]);
    }
  }
  const x0 = Math.floor(minX) - 1;
  const y0 = Math.floor(minY) - 1;
  const width = Math.ceil(maxX) + 1 - x0;
  const height = Math.ceil(maxY) + 1 - y0;
  const moved = paths.map((d) => {
    let i = 0;
    return d.replace(/-?\d*\.?\d+/g, (n) => String(r1(Number(n) - (i++ % 2 === 0 ? x0 : y0))));
  });
  return { width, height, paths: moved };
}

const toSvg = ({ width, height, paths }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="currentColor">\n` +
  paths.map((d) => `  <path d="${d}"/>`).join('\n') +
  '\n</svg>\n';

/**
 * The three strokes. `centre` and `width` are in the pre-crop drawing space; the committed
 * viewBox is whatever the crop gives.
 */
const SPECS = {
  underline: {
    lanes: 4,
    seed: 7,
    rough: 0.35,
    gapMax: 0.09,
    gapFrom: 0.55,
    steps: 26,
    cap: 0.03,
    headLen: 3.2,
    tipShrink: 0.8,
    centre: (t) => [5 + 151 * t, 10 - 3.2 * Math.sin(Math.PI * t * 0.9) + 0.6 * t],
    width: (t) => 3.6 - 0.9 * t + 0.25 * Math.sin(8 * t),
  },
  dab: {
    lanes: 10,
    seed: 5,
    rough: 1.2,
    gapMax: 0.035,
    gapFrom: 0.45,
    gapSpread: 0.3,
    endMin: 0.86,
    steps: 24,
    cap: 0.2,
    headLen: 15,
    headRough: 0.05,
    tipShrink: 0.92,
    tipLen: 0.05,
    centre: (t) => [14 + 92 * t, 46 - 5 * Math.sin(Math.PI * t) - 8 * t],
    width: (t) => 28 - 5 * t + 1.4 * Math.sin(5 * t),
  },
  swash: {
    lanes: 6,
    seed: 23,
    rough: 0.6,
    gapMax: 0.08,
    gapFrom: 0.5,
    steps: 38,
    cap: 0.03,
    headLen: 6,
    tipShrink: 0.85,
    centre: (t) => [6 + 228 * t, 27 - 13 * t + 4.5 * Math.sin(Math.PI * 1.5 * t)],
    width: (t) => 7 - 2.2 * t + 0.5 * Math.sin(10 * t),
  },
};

/** The SVG text for one named stroke. */
function generate(name) {
  const spec = SPECS[name];
  if (!spec) throw new Error(`Unknown brushstroke "${name}"`);
  return toSvg(crop(brush(spec)));
}

/** Flattens a path into a closed polygon, sampling each cubic Bézier `n` times. */
function polygon(d, n = 8) {
  const nums = pathNumbers(d);
  const pts = [[nums[0], nums[1]]];
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const [x0, y0] = pts[pts.length - 1];
    const [x1, y1, x2, y2, x3, y3] = nums.slice(i, i + 6);
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const m = 1 - t;
      pts.push([
        m * m * m * x0 + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x3,
        m * m * m * y0 + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y3,
      ]);
    }
  }
  return pts;
}

/**
 * Where the paint is, on average: the centroid of the union of all paths, as fractions of the
 * viewBox (0 to 1). Used to sit an icon on the dab's paint rather than its bounding box.
 */
function massCentre(svg, step = 0.25) {
  const [, , vw, vh] = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(Number);
  const polys = Array.from(svg.matchAll(/\sd="([^"]+)"/g), (m) => polygon(m[1]));
  let area = 0;
  let sx = 0;
  let sy = 0;
  for (let y = step / 2; y < vh; y += step) {
    // Even-odd spans of each outline on this row, then their union across outlines.
    const spans = [];
    for (const poly of polys) {
      const xs = [];
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i];
        const [bx, by] = poly[(i + 1) % poly.length];
        if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i + 1]]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const w = cur[1] - cur[0];
      area += w * step;
      sx += ((cur[0] + cur[1]) / 2) * w * step;
      sy += y * w * step;
    };
    for (const s of spans) {
      if (cur && s[0] <= cur[1]) cur[1] = Math.max(cur[1], s[1]);
      else {
        flush();
        cur = [s[0], s[1]];
      }
    }
    flush();
  }
  return { x: sx / area / vw, y: sy / area / vh };
}

function main(argv) {
  const write = argv.includes('--write');
  let drift = false;
  for (const name of Object.keys(SPECS)) {
    const file = path.join(BRUSH_DIR, `${name}.svg`);
    const svg = generate(name);
    const viewBox = /viewBox="([^"]+)"/.exec(svg)[1];
    const { x, y } = massCentre(svg);
    const centre = `mass centre ${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%`;
    if (write) {
      fs.writeFileSync(file, svg);
      console.log(`wrote ${path.relative(process.cwd(), file)}  viewBox ${viewBox}  ${centre}`);
    } else {
      const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === svg;
      drift = drift || !same;
      console.log(`${same ? 'ok   ' : 'DRIFT'} ${name}.svg  viewBox ${viewBox}  ${centre}`);
    }
  }
  if (drift) {
    console.error('Committed brush SVGs differ from the generator. Run with --write to update.');
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { BRUSH_DIR, SPECS, brush, generate, massCentre };
