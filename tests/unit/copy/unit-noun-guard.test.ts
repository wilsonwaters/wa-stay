/**
 * @jest-environment node
 *
 * Unit nouns (R9): copy names units by their kinds (`nounForKinds`, `src/shared/utils/unit-noun.ts`),
 * so an RAC cabin is never called a "site". This guard reads the string literals, template
 * text and JSX text (comments removed by `stripComments`) of the core, the scheduler, the
 * renderer's components, the features that show units and Settings (whose notification copy
 * names what a watch finds), and fails on "site" or "sites" in any case, except:
 * - "Site Sniper", the feature's name, and `site-sniper`, its route;
 * - a line marked `unit-noun-ok` with a reason (`// unit-noun-ok: …`).
 *
 * Test files are skipped: their mocks may quote old messages. Provider folders are outside it:
 * ParkStay's sites are sites.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { stripComments } from '../../utils/strip-comments';

const ROOT = path.resolve(__dirname, '../../..');
const SITE = /\bsites?\b/i;
/** The feature's name and its route, which are not unit nouns. */
const ALLOWED = [/Site Sniper/g, /site-sniper/g];
/** The marker, followed by its reason. */
const MARKER = /unit-noun-ok\b[\s:(—–-]+\S/;

const SCANNED_DIRS = [
  'src/main/core',
  'src/main/scheduler',
  'src/renderer/components',
  ...['watches', 'snipes', 'place', 'explore', 'bookings', 'notifications', 'settings'].map(
    (feature) => `src/renderer/features/${feature}`
  ),
];

const isSource = (name: string) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name);

/** Every source file (not a test) under `dir`, relative to the repo root. */
function sourcesUnder(dir: string): string[] {
  const walk = (absolute: string): string[] =>
    fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) return walk(child);
      return isSource(entry.name) ? [child] : [];
    });
  return walk(path.join(ROOT, dir));
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

/** Whether a node is text a person may read: a string, template text or JSX text. */
function isCopy(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node) ||
    ts.isJsxText(node)
  );
}

/** Whether a line of copy says "site" once the feature's name and route are left out. */
function namesSite(text: string): boolean {
  return SITE.test(ALLOWED.reduce((rest, allowed) => rest.replace(allowed, ''), text));
}

/** `file:line: text` for each line of copy that says "site" without the marker. */
function unmarkedSiteCopy(file: string, content = fs.readFileSync(file, 'utf8')): string[] {
  const lines = content.split(/\r?\n/);
  const stripped = stripComments(content);
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, stripped, ts.ScriptTarget.Latest, true, kind);
  const found = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (isCopy(node)) {
      const start = node.getStart(source);
      const first = source.getLineAndCharacterOfPosition(start).line;
      stripped
        .slice(start, node.getEnd())
        .split('\n')
        .forEach((text, offset) => {
          if (namesSite(text)) found.add(first + offset);
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found]
    .sort((a, b) => a - b)
    .filter((index) => !MARKER.test(lines[index]))
    .map((index) => `${rel(file)}:${index + 1}: ${lines[index].trim()}`);
}

const SCANNED = SCANNED_DIRS.flatMap(sourcesUnder);

describe('unit noun guard', () => {
  it('scans the core, the scheduler, the components, the features that show units and Settings', () => {
    const scanned = SCANNED.map(rel);
    expect(scanned).toEqual(
      expect.arrayContaining([
        'src/main/core/notifications/notification.service.ts',
        'src/main/core/watches/watch.service.ts',
        'src/main/core/snipes/snipe.service.ts',
        'src/main/scheduler/job-scheduler.ts',
        'src/renderer/components/stay/UnitPicker.tsx',
        'src/renderer/features/snipes/create/steps/ReleaseStep.tsx',
        'src/renderer/features/explore/availability/deriveAvailability.ts',
        'src/renderer/features/settings/notifications/DesktopSwitches.tsx',
        'src/renderer/features/settings/notifications/email/EmailNotifierCard.tsx',
      ])
    );
    expect(scanned.some((file) => /\.test\.tsx?$/.test(file))).toBe(false);
    expect(scanned.some((file) => file.startsWith('src/main/providers/'))).toBe(false);
  });

  it('finds no "site" in copy outside a line marked unit-noun-ok', () => {
    expect(SCANNED.flatMap((file) => unmarkedSiteCopy(file))).toEqual([]);
  });

  it('fails on a planted literal, template or JSX text, in any case', () => {
    const file = path.join(ROOT, 'src/renderer/features/x.tsx');
    const content = [
      "const a = 'Sites available';",
      'const b = `${n} sites free`;',
      'const c = <p>Choose a SITE</p>;',
      'const d = `Found ${n} ${n === 1 ? "site" : "sites"}`;',
    ].join('\n');
    expect(unmarkedSiteCopy(file, content)).toEqual([
      "src/renderer/features/x.tsx:1: const a = 'Sites available';",
      'src/renderer/features/x.tsx:2: const b = `${n} sites free`;',
      'src/renderer/features/x.tsx:3: const c = <p>Choose a SITE</p>;',
      'src/renderer/features/x.tsx:4: const d = `Found ${n} ${n === 1 ? "site" : "sites"}`;',
    ]);
  });

  it('accepts a marked line, the feature’s name and route, comments and identifiers', () => {
    const file = path.join(ROOT, 'src/main/core/x.ts');
    const content = [
      "const a = 'Book on the site'; // unit-noun-ok: the provider's website",
      "const b = 'Site Sniper holds it';",
      "const c = ROUTES.go('/site-sniper/new');",
      '// Sites available at Osprey Bay',
      '/* a site */ const site = siteSnipe.matchedSiteId;',
      "const d = 'site_snipes';",
    ].join('\n');
    expect(unmarkedSiteCopy(file, content)).toEqual([]);
  });

  it('wants a reason after the marker', () => {
    const file = path.join(ROOT, 'src/main/core/x.ts');
    expect(unmarkedSiteCopy(file, "const a = 'A site'; // unit-noun-ok")).toEqual([
      "src/main/core/x.ts:1: const a = 'A site'; // unit-noun-ok",
    ]);
  });
});
