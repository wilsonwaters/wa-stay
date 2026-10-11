#!/usr/bin/env node
'use strict';

/**
 * WA Stay logo generator: the source of every brand SVG in resources/brand/.
 *
 * The mark is original artwork (brief O4). Its painted stroke comes from the same brush engine
 * and specs as D1's brushstrokes (scripts/brand/brushstrokes.js), so the logo and the nav
 * underline are one gesture. Colours are read from src/renderer/styles/tokens.css, so a token
 * change flows into the logo on the next `npm run icons`.
 *
 * Three concepts are defined below. The brand ships the one named by CONCEPT; every concept is
 * also written to resources/brand/concepts/ for review. To ship a different concept, change
 * CONCEPT and run `npm run icons`, which rewrites the SVGs and every raster.
 *
 * Usage:
 *   node scripts/brand/logo.js          Check the committed SVGs match this script.
 *   node scripts/brand/logo.js --write  Rewrite the SVGs (npm run icons does this too).
 *
 * Every path is filled geometry (no strokes, filters, text or images), with coordinates
 * rounded to 0.1 on a whole-number viewBox.
 */

const fs = require('fs');
const path = require('path');
const { brush, SPECS } = require('./brushstrokes');
const GLYPHS = require('./glyphs.json').texts;

const ROOT = path.resolve(__dirname, '../..');
const BRAND_DIR = path.join(ROOT, 'resources/brand');
const CONCEPTS_DIR = path.join(BRAND_DIR, 'concepts');
const TOKENS_CSS = path.join(ROOT, 'src/renderer/styles/tokens.css');

/** The concept the brand ships. One of the keys of CONCEPTS. */
const CONCEPT = 'roofline';

// ---- Palette ---------------------------------------------------------------------------

/** Raw palette tokens from tokens.css (`--ws-ocean-500: 58 116 184;`) as uppercase hex. */
function readPalette(css = fs.readFileSync(TOKENS_CSS, 'utf8')) {
  const palette = {};
  for (const m of css.matchAll(/--ws-([a-z]+-\d+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    const hex = [m[2], m[3], m[4]].map((n) => Number(n).toString(16).padStart(2, '0'));
    palette[m[1]] = `#${hex.join('').toUpperCase()}`;
  }
  return palette;
}

// ---- Path helpers ----------------------------------------------------------------------

const r1 = (n) => {
  const v = Math.round(n * 10) / 10;
  return Object.is(v, -0) ? 0 : v;
};
const pt = (x, y) => `${r1(x)} ${r1(y)}`;

/**
 * Maps every point of an absolute M/L/Q/C/Z path (the only commands this generator, the brush
 * engine and the glyph outliner emit) through `fn`, rounding to 0.1.
 */
function mapPath(d, fn) {
  return d.replace(/([MLQC])([^MLQCZ]*)/g, (_, cmd, args) => {
    const n = (args.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    const out = [];
    for (let i = 0; i + 1 < n.length; i += 2) {
      const [x, y] = fn(n[i], n[i + 1]);
      out.push(pt(x, y));
    }
    return cmd + out.join(' ');
  });
}

const place = (d, s, tx, ty) => mapPath(d, (x, y) => [x * s + tx, y * s + ty]);

/** Bounds of a path's points, control points included (slightly generous, never tight). */
function bounds(ds) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const d of ds) {
    mapPath(d, (x, y) => {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      return [x, y];
    });
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

const polygon = (pts) => `M${pts.map(([x, y]) => pt(x, y)).join('L')}Z`;

/** Kappa for a quarter circle drawn as one cubic. */
const K = 0.5523;

/** A half disc with its flat edge down, centred on `cx`, the flat edge at `base`. */
function halfDisc(cx, base, r) {
  const k = K * r;
  return (
    `M${pt(cx - r, base)}` +
    `C${pt(cx - r, base - k)} ${pt(cx - k, base - r)} ${pt(cx, base - r)}` +
    `C${pt(cx + k, base - r)} ${pt(cx + r, base - k)} ${pt(cx + r, base)}Z`
  );
}

function disc(cx, cy, r) {
  const k = K * r;
  return (
    `M${pt(cx - r, cy)}` +
    `C${pt(cx - r, cy - k)} ${pt(cx - k, cy - r)} ${pt(cx, cy - r)}` +
    `C${pt(cx + k, cy - r)} ${pt(cx + r, cy - k)} ${pt(cx + r, cy)}` +
    `C${pt(cx + r, cy + k)} ${pt(cx + k, cy + r)} ${pt(cx, cy + r)}` +
    `C${pt(cx - k, cy + r)} ${pt(cx - r, cy + k)} ${pt(cx - r, cy)}Z`
  );
}

/** A rounded rectangle as one path (cubic corners). */
function roundRect(x, y, w, h, r) {
  const k = K * r;
  return (
    `M${pt(x + r, y)}L${pt(x + w - r, y)}` +
    `C${pt(x + w - r + k, y)} ${pt(x + w, y + r - k)} ${pt(x + w, y + r)}` +
    `L${pt(x + w, y + h - r)}` +
    `C${pt(x + w, y + h - r + k)} ${pt(x + w - r + k, y + h)} ${pt(x + w - r, y + h)}` +
    `L${pt(x + r, y + h)}` +
    `C${pt(x + r - k, y + h)} ${pt(x, y + h - r + k)} ${pt(x, y + h - r)}` +
    `L${pt(x, y + r)}` +
    `C${pt(x, y + r - k)} ${pt(x + r - k, y)} ${pt(x + r, y)}Z`
  );
}

/**
 * The roofline chevron: an inverted V with its apex at (cx, top), outer feet at cx ± half on
 * `foot`, and legs `t` thick (measured square to the leg).
 */
function chevron(cx, top, half, foot, t) {
  const rise = foot - top;
  const leg = Math.hypot(half, rise);
  const innerTop = top + (t * leg) / half;
  const innerHalf = half - (t * leg) / rise;
  return polygon([
    [cx, top],
    [cx + half, foot],
    [cx + innerHalf, foot],
    [cx, innerTop],
    [cx - innerHalf, foot],
    [cx - half, foot],
  ]);
}

/**
 * The logo's sea: D1's swash spec (same lanes, roughness and dry-brush tail) pulled along a
 * new centreline, painted left to right like the nav underline.
 */
function seaStroke({ from, to, y, half, seed = 11, gapFrom = 0.72 }) {
  return brush({
    ...SPECS.swash,
    seed,
    lanes: 7,
    rough: 0.9,
    gapMax: 0.07,
    gapFrom,
    steps: 40,
    headLen: half * 0.9,
    centre: (t) => [from + (to - from) * t, y - 3 * Math.sin(Math.PI * t) + 2 * t],
    width: (t) => half - 0.22 * half * t + 0.06 * half * Math.sin(9 * t),
  });
}

/** A short pull of D1's underline spec: small accents (the coral glint). */
function dash({ from, to, y, half, seed = 3 }) {
  return brush({
    ...SPECS.underline,
    seed,
    centre: (t) => [from + (to - from) * t, y - Math.sin(Math.PI * t)],
    width: (t) => half - 0.3 * half * t,
    headLen: half * 0.9,
  });
}

/** D1's dab, scaled `s` times about the origin of its drawing space. */
function scaledDab(s, dx, dy, seed = SPECS.dab.seed) {
  const spec = SPECS.dab;
  return brush({
    ...spec,
    seed,
    rough: spec.rough * s,
    headLen: spec.headLen * s,
    centre: (t) => {
      const [x, y] = spec.centre(t);
      return [x * s + dx, y * s + dy];
    },
    width: (t) => spec.width(t) * s,
  });
}

/** An outlined text from glyphs.json, scaled so its cap height is `cap`, baseline at (x, y). */
function text(key, cap, x, y) {
  const g = GLYPHS[key];
  const s = cap / g.capHeight;
  return { d: place(g.d, s, x, y), width: g.advance * s };
}

const shape = (fill, d) => ({ fill, d });
const shapes = (fill, ds) => ds.map((d) => shape(fill, d));

// ---- Concepts --------------------------------------------------------------------------
//
// Each concept draws on a 256 x 256 artboard (symbol, mono) and a 32 x 32 grid (small, which
// sits on the icon plate). Fills are palette token names. `axis` is the x of the symbol's
// optical centre in artboard units; without it the symbol is centred on its bounds.

const CONCEPTS = {
  roofline: {
    name: 'Roofline sunset',
    idea: 'A gold sun sets into an Indian Ocean brushstroke under an ink roofline: a place to stay, and the A of WA.',
    axis: 128, // the chevron apex: the roof and the sun are symmetric about it
    symbol() {
      return [
        shape('ink-900', chevron(128, 44, 96, 170, 22)),
        shape('sun-400', halfDisc(128, 148, 33)),
        ...shapes('ocean-500', seaStroke({ from: 12, to: 246, y: 164, half: 19 })),
        // The sun's glow where it meets the water: the logo's single coral accent.
        ...shapes('coral-400', dash({ from: 108, to: 146, y: 158, half: 5.4 })),
      ];
    },
    mono() {
      // One colour: the sun rests on the water, so it reads as a sunset rather than a dome.
      return [
        chevron(128, 44, 96, 170, 22),
        halfDisc(128, 150, 33),
        ...seaStroke({ from: 12, to: 246, y: 164, half: 19 }),
      ];
    },
    small() {
      return [
        shape('ink-900', chevron(16, 3.5, 14, 22, 4.25)),
        shape('sun-400', halfDisc(16, 20, 4.5)),
        shape('ocean-500', roundRect(2, 20, 28, 4.5, 2.25)),
      ];
    },
  },

  'sun-tent': {
    name: 'Sun tent',
    idea: 'The setting sun is also a dome tent, its door open onto an Indian Ocean brushstroke.',
    axis: 128, // the centre of the sun and the apex of the door
    symbol() {
      return [
        shape('sun-400', halfDisc(128, 168, 84)),
        shape(
          'ink-900',
          polygon([
            [128, 100],
            [158, 168],
            [98, 168],
          ])
        ),
        ...shapes('ocean-500', seaStroke({ from: 14, to: 242, y: 178, half: 18, seed: 19 })),
      ];
    },
    mono() {
      const door = polygon([
        [128, 100],
        [98, 160],
        [158, 160],
      ]);
      return [
        halfDisc(128, 160, 84) + door,
        ...seaStroke({ from: 14, to: 242, y: 178, half: 18, seed: 19 }),
      ];
    },
    small() {
      return [
        shape('sun-400', halfDisc(16, 21, 12.5)),
        shape(
          'ink-900',
          polygon([
            [16, 11],
            [20.5, 21],
            [11.5, 21],
          ])
        ),
        shape('ocean-500', roundRect(2, 20, 28, 4.5, 2.25)),
      ];
    },
  },

  monogram: {
    name: 'Painted monogram',
    idea: 'WA in Fraunces, reversed out of one loaded stroke of ocean, with the sun going down behind it.',
    symbol() {
      const letters = text('monogram', 58, 0, 0);
      const dab = scaledDab(2.3, -4, 16);
      // Sit the letters on the paint's mass centre (measured by brushstrokes.js), not its box.
      const box = bounds(dab);
      const cx = box.x0 + 0.459 * box.w;
      const cy = box.y0 + 0.46 * box.h;
      return [
        shape('sun-400', disc(190, 64, 32)),
        ...shapes('ocean-500', dab),
        shape('sand-0', place(letters.d, 1, cx - letters.width / 2, cy + 29)),
      ];
    },
    mono() {
      const letters = text('monogram', 70, 0, 0);
      const x = 128 - letters.width / 2;
      return [
        place(letters.d, 1, x, 150),
        ...seaStroke({ from: 40, to: 216, y: 178, half: 11, seed: 23 }),
        disc(196, 84, 14),
      ];
    },
    small() {
      const letters = text('monogram', 10, 0, 0);
      return [
        shape('ocean-500', roundRect(2.5, 6, 27, 20, 5)),
        shape('sand-0', place(letters.d, 1, 16 - letters.width / 2, 21)),
      ];
    },
  },
};

// ---- Brand SVG builders ----------------------------------------------------------------

const PLATE = { fill: 'sand-50', radius: 56 / 256 };

function svgDoc(width, height, body, extra = '') {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"${extra}>\n` +
    `  <title>WA Stay</title>\n` +
    body.map((line) => `  ${line}`).join('\n') +
    '\n</svg>\n'
  );
}

const pathEl = (fill, d) => `<path fill="${fill}" d="${d}"/>`;
const colour = (palette, token) => {
  const hex = palette[token];
  if (!hex) throw new Error(`Unknown palette token "${token}" (not in tokens.css)`);
  return hex;
};
const paint = (palette, list) => list.map((s) => pathEl(colour(palette, s.fill), s.d));

/**
 * Moves and scales shapes so they fit inside `box`, returning the new shapes. They are centred
 * vertically on their bounds. Horizontally they are centred on `axis` (an x in the shapes' own
 * units) when one is given, otherwise on their bounds. The brushstroke's ragged head and dry
 * tail are not symmetric, so centring its bounds would push the roof off the middle of a plate.
 */
function fit(list, box, axis) {
  const b = bounds(list.map((s) => s.d));
  const w = axis === undefined ? b.w : 2 * Math.max(axis - b.x0, b.x1 - axis);
  const s = Math.min(box.w / w, box.h / b.h);
  const tx =
    axis === undefined ? box.x + (box.w - b.w * s) / 2 - b.x0 * s : box.x + box.w / 2 - axis * s;
  const ty = box.y + (box.h - b.h * s) / 2 - b.y0 * s;
  return list.map((sh) => ({ ...sh, d: place(sh.d, s, tx, ty) }));
}

/** The square, full-colour mark: the symbol on its sand plate (the app icon from 48 px). */
function mark(concept, palette) {
  const size = 256;
  const plate = `<rect width="${size}" height="${size}" rx="${size * PLATE.radius}" fill="${colour(palette, PLATE.fill)}"/>`;
  const body = fit(concept.symbol(), { x: 22, y: 22, w: 212, h: 212 }, concept.axis);
  return svgDoc(size, size, [plate, ...paint(palette, body)]);
}

/** The 16 to 32 px mark: at most three solid shapes on the plate, drawn on a 32 grid. */
function markSmall(concept, palette) {
  const plate = `<rect width="32" height="32" rx="${32 * PLATE.radius}" fill="${colour(palette, PLATE.fill)}"/>`;
  return svgDoc(32, 32, [plate, ...paint(palette, concept.small())]);
}

/** The mono mark: the symbol alone in currentColor, on a square artboard. */
function markMono(concept) {
  const list = concept.mono().map((d) => ({ fill: 'currentColor', d }));
  const body = fit(list, { x: 8, y: 8, w: 240, h: 240 }, concept.axis);
  return svgDoc(
    256,
    256,
    body.map((s) => `<path d="${s.d}"/>`),
    ' fill="currentColor"'
  );
}

/**
 * The horizontal lockup: symbol, then the Fraunces wordmark. The symbol is twice the cap
 * height, the gap is 0.3 of the symbol height, and the cap height is centred on the symbol.
 */
function lockupLayout(symbolList) {
  const H = 96;
  const cap = H / 2;
  const sym = fit(symbolList, { x: 0, y: 0, w: 1000, h: H });
  const sb = bounds(sym.map((s) => s.d));
  const word = text('wordmark', cap, 0, 0);
  const wx = sb.x1 + H * 0.3;
  const baseline = sb.y0 + sb.h / 2 + cap / 2;
  const wd = place(word.d, 1, wx, baseline);
  const all = bounds([...sym.map((s) => s.d), wd]);
  const pad = 2;
  const width = Math.ceil(all.x1 - all.x0 + 2 * pad);
  const height = Math.ceil(all.y1 - all.y0 + 2 * pad);
  const dx = pad - all.x0 + (width - (all.x1 - all.x0 + 2 * pad)) / 2;
  const dy = pad - all.y0 + (height - (all.y1 - all.y0 + 2 * pad)) / 2;
  return {
    width,
    height,
    symbol: sym.map((s) => ({ ...s, d: place(s.d, 1, dx, dy) })),
    word: place(wd, 1, dx, dy),
  };
}

function lockup(concept, palette) {
  const l = lockupLayout(concept.symbol());
  return svgDoc(l.width, l.height, [
    ...paint(palette, l.symbol),
    pathEl(colour(palette, 'ink-900'), l.word),
  ]);
}

function lockupMono(concept) {
  const l = lockupLayout(concept.mono().map((d) => ({ fill: 'currentColor', d })));
  return svgDoc(
    l.width,
    l.height,
    [...l.symbol.map((s) => `<path d="${s.d}"/>`), `<path d="${l.word}"/>`],
    ' fill="currentColor"'
  );
}

/** Places the lockup at (x, y) scaled to `width`, returning painted path elements. */
function lockupAt(concept, palette, x, y, width) {
  const l = lockupLayout(concept.symbol());
  const s = width / l.width;
  return {
    height: l.height * s,
    els: [
      ...paint(
        palette,
        l.symbol.map((sh) => ({ ...sh, d: place(sh.d, s, x, y) }))
      ),
      pathEl(colour(palette, 'ink-900'), place(l.word, s, x, y)),
    ],
  };
}

/** The 1280 x 640 README banner, which is also the GitHub social preview. */
function readmeBanner(concept, palette) {
  const W = 1280;
  const H = 640;
  const lw = 600;
  const probe = lockupLayout(concept.symbol());
  const lh = (probe.height * lw) / probe.width;
  const cap = 26;
  const tag = text('tagline', cap, 0, 0);
  const gap = 56;
  const top = (H - (lh + gap + cap)) / 2;
  const lock = lockupAt(concept, palette, (W - lw) / 2, top, lw);
  const tagline = place(tag.d, 1, (W - tag.width) / 2, top + lh + gap + cap);
  return svgDoc(W, H, [
    `<rect width="${W}" height="${H}" fill="${colour(palette, 'sand-50')}"/>`,
    ...lock.els,
    pathEl(colour(palette, 'ink-700'), tagline),
  ]);
}

/** NSIS header (150 x 57, shown top right on white): the lockup, right-aligned. */
function installerHeader(concept, palette) {
  const W = 150;
  const H = 57;
  const lw = 118;
  const probe = lockupLayout(concept.symbol());
  const lh = (probe.height * lw) / probe.width;
  const lock = lockupAt(concept, palette, W - lw - 10, (H - lh) / 2, lw);
  return svgDoc(W, H, [
    `<rect width="${W}" height="${H}" fill="${colour(palette, 'sand-0')}"/>`,
    ...lock.els,
  ]);
}

/** NSIS welcome and finish sidebar (164 x 314): its own artboard, symbol over wordmark. */
function installerSidebar(concept, palette) {
  const W = 164;
  const H = 314;
  const sym = fit(concept.symbol(), { x: 26, y: 70, w: 112, h: 80 }, concept.axis);
  const sb = bounds(sym.map((s) => s.d));
  const cap = 21;
  const word = text('wordmark', cap, 0, 0);
  const wordD = place(word.d, 1, (W - word.width) / 2, sb.y1 + 26 + cap);
  return svgDoc(W, H, [
    `<rect width="${W}" height="${H}" fill="${colour(palette, 'sand-50')}"/>`,
    ...paint(palette, sym),
    pathEl(colour(palette, 'ink-900'), wordD),
  ]);
}

/** Every brand SVG for one concept, keyed by file name. */
function brandFiles(conceptId = CONCEPT, palette = readPalette()) {
  const concept = CONCEPTS[conceptId];
  if (!concept) throw new Error(`Unknown concept "${conceptId}"`);
  return {
    'wa-stay-mark.svg': mark(concept, palette),
    'wa-stay-mark-small.svg': markSmall(concept, palette),
    'wa-stay-mark-mono.svg': markMono(concept),
    'wa-stay-lockup.svg': lockup(concept, palette),
    'wa-stay-lockup-mono.svg': lockupMono(concept),
    'readme-banner.svg': readmeBanner(concept, palette),
  };
}

/** The review set for every concept: mark, small mark and lockup. */
function conceptFiles(palette = readPalette()) {
  const files = {};
  for (const [id, concept] of Object.entries(CONCEPTS)) {
    files[`${id}-mark.svg`] = mark(concept, palette);
    files[`${id}-mark-small.svg`] = markSmall(concept, palette);
    files[`${id}-lockup.svg`] = lockup(concept, palette);
  }
  return files;
}

/** In-memory artboards for the installer bitmaps (never committed as SVG). */
function installerArtboards(conceptId = CONCEPT, palette = readPalette()) {
  const concept = CONCEPTS[conceptId];
  return {
    header: installerHeader(concept, palette),
    sidebar: installerSidebar(concept, palette),
  };
}

/** Writes (or, with write = false, checks) every brand and concept SVG. Returns drifted files. */
function syncSvgs({ write }) {
  const palette = readPalette();
  const targets = [
    ...Object.entries(brandFiles(CONCEPT, palette)).map(([f, svg]) => [
      path.join(BRAND_DIR, f),
      svg,
    ]),
    ...Object.entries(conceptFiles(palette)).map(([f, svg]) => [path.join(CONCEPTS_DIR, f), svg]),
  ];
  const drift = [];
  for (const [file, svg] of targets) {
    const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === svg;
    if (!same) drift.push(file);
    if (write && !same) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, svg);
    }
  }
  return { files: targets.map(([f]) => f), drift };
}

function main(argv) {
  const write = argv.includes('--write');
  const { files, drift } = syncSvgs({ write });
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const changed = drift.includes(file);
    console.log(`${write ? (changed ? 'wrote' : 'same ') : changed ? 'DRIFT' : 'ok   '} ${rel}`);
  }
  if (!write && drift.length) {
    console.error('Committed brand SVGs differ from the generator. Run `npm run icons`.');
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  BRAND_DIR,
  CONCEPT,
  CONCEPTS,
  CONCEPTS_DIR,
  brandFiles,
  conceptFiles,
  installerArtboards,
  readPalette,
  syncSvgs,
};
