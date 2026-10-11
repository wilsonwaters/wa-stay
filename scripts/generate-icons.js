#!/usr/bin/env node
'use strict';

/**
 * npm run icons: builds every WA Stay brand asset from scripts/brand/logo.js.
 *
 * 1. Writes the brand SVGs (resources/brand/*.svg) and the concept review set
 *    (resources/brand/concepts/*.svg) from the generator, with colours from tokens.css.
 * 2. Reads each source SVG back and stops, naming the file, if one is missing or is not
 *    well-formed XML.
 * 3. Rasterises with sharp (librsvg):
 *    - resources/icons/icon.ico: 16, 24, 32, 48, 64, 128, 256 (32 and below from the small mark)
 *    - resources/icons/icon.png (1024) and the Linux set NxN.png (16 to 1024)
 *    - resources/icons/email-logo.png (80): the inline logo of the SMTP emails, shown at 40 px
 *    - resources/icons/installer-header.bmp (150x57) and installer-sidebar.bmp (164x314),
 *      24-bit uncompressed BMP written by scripts/lib/bmp.js
 *    - resources/brand/readme-banner.png (1280x640)
 *    - src/renderer/assets/brand/{logo-mark,logo-lockup,logo-mark-mono}.svg (byte copies)
 *    - docs/design/brand/contact-sheet.png and resources/brand/concepts/contact-sheet.png
 *
 * Everything is deterministic: a second run on the same machine changes no bytes. CI never runs
 * this, because librsvg anti-aliasing differs between operating systems; the output is committed.
 * Nothing here touches the network.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const logo = require('./brand/logo');
const { encodeBmp } = require('./lib/bmp');

const ROOT = path.resolve(__dirname, '..');
const BRAND_DIR = logo.BRAND_DIR;
const CONCEPTS_DIR = logo.CONCEPTS_DIR;
const ICONS_DIR = path.join(ROOT, 'resources', 'icons');
const RENDERER_BRAND_DIR = path.join(ROOT, 'src', 'renderer', 'assets', 'brand');
const DOCS_BRAND_DIR = path.join(ROOT, 'docs', 'design', 'brand');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const SMALL_MAX = 32;
/** Emails show the logo at 40 px: 2x for high-density screens, a few KB instead of the 1024. */
const EMAIL_LOGO_SIZE = 80;

/** Renderer copies: D3 and U5 import these exact paths. */
const RENDERER_COPIES = {
  'logo-mark.svg': 'wa-stay-mark.svg',
  'logo-lockup.svg': 'wa-stay-lockup.svg',
  'logo-mark-mono.svg': 'wa-stay-mark-mono.svg',
};

const rel = (file) => path.relative(ROOT, file);

/**
 * Well-formedness check without an XML dependency: every tag closes in order, attributes are
 * quoted, and the document is one <svg> element. librsvg then parses it for real.
 */
function checkXml(text) {
  const body = text.replace(/<\?xml[^>]*\?>/, '').trim();
  if (!body.startsWith('<svg')) throw new Error('does not start with <svg');
  const stack = [];
  const tag =
    /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|</g;
  let m;
  let last;
  while ((m = tag.exec(body))) {
    if (m[0] === '<') throw new Error(`malformed tag at offset ${m.index}`);
    last = m.index + m[0].length;
    if (m[0].startsWith('<!--')) continue;
    const [, close, name, , selfClose] = m;
    if (close) {
      const open = stack.pop();
      if (open !== name) throw new Error(`</${name}> closes <${open ?? 'nothing'}>`);
      if (stack.length === 0 && body.slice(last).trim()) throw new Error('content after </svg>');
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  if (stack.length) throw new Error(`<${stack[stack.length - 1]}> is never closed`);
}

/** Reads a source SVG, or throws an error that names the file. */
async function readSvg(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing source SVG: ${rel(file)}`);
  const text = fs.readFileSync(file, 'utf8');
  try {
    checkXml(text);
    await sharp(Buffer.from(text)).metadata();
  } catch (error) {
    throw new Error(`Invalid SVG ${rel(file)}: ${error.message}`, { cause: error });
  }
  return text;
}

/** viewBox width and height of an SVG string. */
function viewBoxSize(svg) {
  const [, , w, h] = /viewBox="([^"]+)"/.exec(svg)[1].trim().split(/\s+/).map(Number);
  return { w, h };
}

/** Renders an SVG at exactly width x height, letting librsvg anti-alias at the target size. */
function render(svg, width, height = width) {
  const { w } = viewBoxSize(svg);
  return sharp(Buffer.from(svg), { density: (72 * width) / w }).resize(width, height, {
    fit: 'fill',
  });
}

const png = (svg, width, height) => render(svg, width, height).png().toBuffer();

function writeIfChanged(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const same = fs.existsSync(file) && fs.readFileSync(file).equals(buf);
  if (!same) fs.writeFileSync(file, buf);
  console.log(`${same ? 'same ' : 'wrote'} ${rel(file)}`);
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

async function bmp(svg, width, height, backgroundHex) {
  const background = rgb(backgroundHex);
  const { data, info } = await render(svg, width, height)
    .flatten({ background: { r: background[0], g: background[1], b: background[2] } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encodeBmp(
    { data, width: info.width, height: info.height, channels: info.channels },
    background
  );
}

// ---- Contact sheets --------------------------------------------------------------------

const LABEL_FONT = 'DejaVu Sans, Segoe UI, Arial, sans-serif';

/** A sheet: coloured bands and labels as one SVG, then rendered tiles composited on top. */
async function sheet(width, height, palette, bands, labels, tiles) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="${palette['sand-100']}"/>` +
    bands
      .map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${b.fill}"/>`)
      .join('') +
    labels
      .map(
        (l) =>
          `<text x="${l.x}" y="${l.y}" font-family="${LABEL_FONT}" font-size="${l.size || 14}"` +
          ` font-weight="${l.weight || 400}" fill="${l.fill || palette['ink-700']}">${esc(l.text)}</text>`
      )
      .join('') +
    '</svg>';
  return sharp(Buffer.from(svg))
    .composite(tiles.map((t) => ({ input: t.input, left: Math.round(t.x), top: Math.round(t.y) })))
    .png()
    .toBuffer();
}

/** Enlarges a rendered tile with nearest-neighbour, so each pixel can be inspected. */
async function zoom(buf, factor) {
  const { width, height } = await sharp(buf).metadata();
  return sharp(buf)
    .resize(width * factor, height * factor, { kernel: 'nearest' })
    .png()
    .toBuffer();
}

/** Recolours a currentColor SVG for display (a mono mark in white on ocean, say). */
const tint = (svg, hex) => svg.replace(/currentColor/g, hex);

/** Splits text into lines of at most `max` characters, breaking between words. */
function wrap(text, max) {
  const lines = [''];
  for (const word of text.split(' ')) {
    const line = lines[lines.length - 1];
    if (line && line.length + 1 + word.length > max) lines.push(word);
    else lines[lines.length - 1] = line ? `${line} ${word}` : word;
  }
  return lines;
}

/**
 * docs/design/brand/contact-sheet.png: the shipping icon at 16/24/32/48/256 on sand and on ink
 * (the dark taskbar), both installer images, the lockups, and the alternative concepts.
 */
async function brandSheet({ palette, svgs, icons, installer, conceptSvgs }) {
  const W = 1480;
  const H = 1300;
  const bands = [];
  const labels = [];
  const tiles = [];
  const heading = (x, y, text, fill) => labels.push({ x, y, text, size: 16, weight: 700, fill });

  labels.push({
    x: 40,
    y: 52,
    text: 'WA Stay brand contact sheet',
    size: 26,
    weight: 700,
    fill: palette['ink-900'],
  });
  labels.push({
    x: 40,
    y: 80,
    text: `Concept: ${logo.CONCEPTS[logo.CONCEPT].name}. Generated by npm run icons from scripts/brand/logo.js.`,
  });

  // Rows 1 and 2: the icon at real size on sand and on ink, then 16, 24 and 32 at 4x.
  const rows = [
    {
      name: 'On sand (light taskbar, Start menu)',
      fill: palette['sand-50'],
      text: palette['ink-700'],
    },
    { name: 'On ink (dark taskbar)', fill: palette['ink-900'], text: palette['sand-0'] },
  ];
  for (let r = 0; r < rows.length; r++) {
    const top = 110 + r * 380;
    const base = top + 320; // icons sit on this line
    bands.push({ x: 0, y: top, w: W, h: 360, fill: rows[r].fill });
    heading(40, top + 34, rows[r].name, rows[r].text);
    let x = 40;
    for (const s of [16, 24, 32, 48, 256]) {
      tiles.push({ input: icons[s], x, y: base - s });
      labels.push({ x, y: base + 26, text: `${s}`, size: 13, fill: rows[r].text });
      x += Math.max(s, 24) + 28;
    }
    x += 60;
    for (const s of [16, 24, 32]) {
      tiles.push({ input: await zoom(icons[s], 4), x, y: base - s * 4 });
      labels.push({ x, y: base + 26, text: `${s} at 4x`, size: 13, fill: rows[r].text });
      x += s * 4 + 40;
    }
  }

  // Row 3: installer art, lockups, mono marks and the alternatives.
  const top = 880;
  heading(40, top, 'Installer header, 150 x 57');
  tiles.push({ input: installer.header, x: 40, y: top + 16 });
  labels.push({ x: 40, y: top + 106, text: 'At 2x, for inspection', size: 13 });
  tiles.push({ input: await zoom(installer.header, 2), x: 40, y: top + 118 });
  heading(380, top, 'Sidebar, 164 x 314');
  tiles.push({ input: installer.sidebar, x: 380, y: top + 16 });

  const lockSvg = svgs['wa-stay-lockup.svg'];
  const lockW = 440;
  const lockH = Math.round((lockW * viewBoxSize(lockSvg).h) / viewBoxSize(lockSvg).w);
  heading(620, top, 'Lockup on sand');
  bands.push({ x: 620, y: top + 16, w: lockW + 40, h: lockH + 40, fill: palette['sand-50'] });
  tiles.push({ input: await png(lockSvg, lockW, lockH), x: 640, y: top + 36 });
  const monoTop = top + lockH + 90;
  heading(620, monoTop, 'Mono lockup, reversed on ocean');
  bands.push({ x: 620, y: monoTop + 16, w: lockW + 40, h: lockH + 40, fill: palette['ocean-500'] });
  tiles.push({
    input: await png(tint(svgs['wa-stay-lockup-mono.svg'], palette['sand-0']), lockW, lockH),
    x: 640,
    y: monoTop + 36,
  });

  heading(1140, top, 'Mono mark, ink and ocean');
  tiles.push({
    input: await png(tint(svgs['wa-stay-mark-mono.svg'], palette['ink-900']), 128),
    x: 1140,
    y: top + 16,
  });
  tiles.push({
    input: await png(tint(svgs['wa-stay-mark-mono.svg'], palette['ocean-600']), 128),
    x: 1290,
    y: top + 16,
  });

  const altTop = top + 190;
  heading(1140, altTop, 'Alternatives (BQ1)');
  let ax = 1140;
  for (const id of Object.keys(logo.CONCEPTS).filter((c) => c !== logo.CONCEPT)) {
    tiles.push({ input: await png(conceptSvgs[`${id}-mark.svg`], 96), x: ax, y: altTop + 16 });
    tiles.push({
      input: await png(conceptSvgs[`${id}-mark-small.svg`], 32),
      x: ax + 104,
      y: altTop + 16,
    });
    tiles.push({
      input: await png(conceptSvgs[`${id}-mark-small.svg`], 16),
      x: ax + 104,
      y: altTop + 60,
    });
    labels.push({ x: ax, y: altTop + 134, text: logo.CONCEPTS[id].name, size: 13 });
    ax += 160;
  }
  labels.push({ x: 1140, y: altTop + 160, text: 'Full set: resources/brand/concepts/', size: 13 });
  return sheet(W, H, palette, bands, labels, tiles);
}

/**
 * resources/brand/concepts/contact-sheet.png: every concept side by side at 256, 32 and 16 px
 * (on sand and on ink) and as a lockup, with the shipping concept marked.
 */
async function conceptSheet({ palette, conceptSvgs }) {
  const ids = Object.keys(logo.CONCEPTS);
  const colW = 480;
  const W = colW * ids.length + 40;
  const H = 860;
  const bands = [];
  const labels = [];
  const tiles = [];
  labels.push({
    x: 40,
    y: 50,
    text: 'WA Stay logo concepts',
    size: 26,
    weight: 700,
    fill: palette['ink-900'],
  });
  labels.push({
    x: 40,
    y: 78,
    text: 'Each mark at 256, 32 and 16 px on sand and on ink, then as a lockup.',
  });

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const c = logo.CONCEPTS[id];
    const x = 40 + i * colW;
    const top = 110;
    bands.push({ x, y: top, w: colW - 40, h: H - top - 30, fill: palette['sand-50'] });
    labels.push({
      x: x + 20,
      y: top + 36,
      text: c.name,
      size: 20,
      weight: 700,
      fill: palette['ink-900'],
    });
    if (id === logo.CONCEPT) {
      labels.push({
        x: x + colW - 190,
        y: top + 36,
        text: 'Recommended',
        size: 14,
        weight: 700,
        fill: palette['ocean-700'],
      });
    }
    tiles.push({ input: await png(conceptSvgs[`${id}-mark.svg`], 256), x: x + 92, y: top + 56 });

    // 32 and 16 px on sand, then on an ink strip, each with a 4x zoom.
    const sy = top + 330;
    bands.push({ x: x + 220, y: sy - 10, w: colW - 260, h: 150, fill: palette['ink-900'] });
    for (const [s, dy] of [
      [32, 0],
      [16, 84],
    ]) {
      const icon = await png(conceptSvgs[`${id}-mark-small.svg`], s);
      tiles.push({ input: icon, x: x + 20, y: sy + dy + (32 - s) });
      tiles.push({ input: await zoom(icon, s === 16 ? 4 : 2), x: x + 64, y: sy + dy });
      tiles.push({ input: icon, x: x + 240, y: sy + dy + (32 - s) });
      tiles.push({ input: await zoom(icon, s === 16 ? 4 : 2), x: x + 284, y: sy + dy });
      labels.push({ x: x + 150, y: sy + dy + 40, text: `${s} px`, size: 13 });
    }

    const lockSvg = conceptSvgs[`${id}-lockup.svg`];
    const lw = colW - 80;
    const lh = Math.round((lw * viewBoxSize(lockSvg).h) / viewBoxSize(lockSvg).w);
    tiles.push({ input: await png(lockSvg, lw, lh), x: x + 20, y: sy + 190 });
    wrap(c.idea, 66).forEach((line, n) =>
      labels.push({ x: x + 20, y: H - 78 + n * 18, text: line, size: 12 })
    );
  }
  return sheet(W, H, palette, bands, labels, tiles);
}

// ---- Pipeline --------------------------------------------------------------------------

async function run() {
  console.log(`Concept: ${logo.CONCEPT}`);
  const { files, drift } = logo.syncSvgs({ write: true });
  for (const file of files) console.log(`${drift.includes(file) ? 'wrote' : 'same '} ${rel(file)}`);

  const palette = logo.readPalette();
  const svgs = {};
  for (const name of Object.keys(logo.brandFiles(logo.CONCEPT, palette))) {
    svgs[name] = await readSvg(path.join(BRAND_DIR, name));
  }
  const conceptSvgs = {};
  for (const name of Object.keys(logo.conceptFiles(palette))) {
    conceptSvgs[name] = await readSvg(path.join(CONCEPTS_DIR, name));
  }

  // Icons: 32 px and below come from the small mark.
  const iconSvg = (size) =>
    size <= SMALL_MAX ? svgs['wa-stay-mark-small.svg'] : svgs['wa-stay-mark.svg'];
  const icons = {};
  for (const size of [...new Set([...ICO_SIZES, ...PNG_SIZES])].sort((a, b) => a - b)) {
    icons[size] = await png(iconSvg(size), size);
  }
  const { default: pngToIco } = await import('png-to-ico');
  writeIfChanged(path.join(ICONS_DIR, 'icon.ico'), await pngToIco(ICO_SIZES.map((s) => icons[s])));
  writeIfChanged(path.join(ICONS_DIR, 'icon.png'), icons[1024]);
  for (const size of PNG_SIZES) {
    writeIfChanged(path.join(ICONS_DIR, `${size}x${size}.png`), icons[size]);
  }
  writeIfChanged(
    path.join(ICONS_DIR, 'email-logo.png'),
    await png(iconSvg(EMAIL_LOGO_SIZE), EMAIL_LOGO_SIZE)
  );

  // Installer bitmaps: their own artboards, flattened onto white (header) and sand (sidebar).
  const boards = logo.installerArtboards(logo.CONCEPT, palette);
  for (const [name, svg] of Object.entries(boards)) {
    try {
      checkXml(svg);
    } catch (error) {
      throw new Error(`Invalid installer ${name} artboard: ${error.message}`, { cause: error });
    }
  }
  const header = await bmp(boards.header, 150, 57, palette['sand-0']);
  const sidebar = await bmp(boards.sidebar, 164, 314, palette['sand-50']);
  writeIfChanged(path.join(ICONS_DIR, 'installer-header.bmp'), header);
  writeIfChanged(path.join(ICONS_DIR, 'installer-sidebar.bmp'), sidebar);

  writeIfChanged(
    path.join(BRAND_DIR, 'readme-banner.png'),
    await png(svgs['readme-banner.svg'], 1280, 640)
  );

  for (const [copy, source] of Object.entries(RENDERER_COPIES)) {
    writeIfChanged(path.join(RENDERER_BRAND_DIR, copy), Buffer.from(svgs[source]));
  }

  const installer = {
    header: await png(boards.header, 150, 57),
    sidebar: await png(boards.sidebar, 164, 314),
  };
  writeIfChanged(
    path.join(DOCS_BRAND_DIR, 'contact-sheet.png'),
    await brandSheet({ palette, svgs, icons, installer, conceptSvgs })
  );
  writeIfChanged(
    path.join(CONCEPTS_DIR, 'contact-sheet.png'),
    await conceptSheet({ palette, conceptSvgs })
  );
  console.log('Brand assets are up to date.');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { ICO_SIZES, PNG_SIZES, EMAIL_LOGO_SIZE, RENDERER_COPIES, checkXml, readSvg, run };
