/**
 * @jest-environment node
 *
 * The provider docs stay true to the code and readable from outside the project:
 * - provider-facing docs (`docs/providers/**`) carry no internal references (plan sections,
 *   stage or brief codes, issue numbers) that mean nothing to an outside author;
 * - the guide's core timeouts are the code's (`DEFAULT_CATALOG_TIMINGS`, the sign-in check's
 *   `DEFAULT_ACCOUNT_TIMINGS`, the HTTP and page timeouts), and so are the search-mode limits
 *   the guides describe;
 * - the guide's lists of location kinds (with how each reads) and stay-field types are the
 *   types' own (`src/shared/types/provider.types.ts`), and so are the fields of a bulk
 *   availability entry, each documented on the type too;
 * - the guide's quick start and the scaffold agree on the flags;
 * - the agents' checklist (CLAUDE.md, "Adding a provider") names the scaffold, the gate and the
 *   rules, and AGENTS.md and the `/add-provider` command point to it rather than copy it.
 */

import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { DEFAULT_ACCOUNT_TIMINGS } from '@main/core/accounts/provider-account.service';
import {
  AREA_SEARCH_MAX_PAGES,
  AREA_SEARCHES_KEPT,
  DEFAULT_CATALOG_TIMINGS,
  SEARCH_MEMORY_SIZE,
  TEXT_SEARCH_MAX_ITEMS,
  TEXT_SEARCH_MIN_CHARS,
} from '@main/core/catalog/location-catalog.service';
import { DEFAULT_PAGE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from '@main/providers/sdk';
import { KIND_LABELS, unitNoun } from '@renderer/components/locationFormat';
import { LOCATION_KINDS, StayFieldDescriptorSchema } from '@shared/types/provider.types';
import { docFiles, readDoc, ROOT } from './markdown';

const GUIDE = 'docs/providers/adding-a-provider.md';

/**
 * Internal references: plan sections (§12.30), stages (V7), the brief (D5), issues (#24), open
 * questions (PQ1, UQ1, O8).
 */
const INTERNAL = [
  /§\s?\d/,
  /\b[A-Z]?Q\d+\b/,
  /\bO\d+\b/,
  /\bV\d+\b/,
  /\bbrief [A-Z]\d+\b/i,
  /architecture-notes/,
  /\(#\d+\)/,
  /\bin #\d+\b/,
];

const UNITS: Record<string, number> = {
  s: 1_000,
  minute: 60_000,
  minutes: 60_000,
  hour: 3_600_000,
  hours: 3_600_000,
};

/** The section of `text` under the heading `heading`, up to the next heading of its level. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) return '';
  const level = /^#+/.exec(heading)![0];
  const next = text.slice(start + heading.length + 2).search(new RegExp(`\\n${level} `));
  return next < 0 ? text.slice(start) : text.slice(start, start + heading.length + 2 + next);
}

describe('provider-facing docs', () => {
  const docs = docFiles().filter((file) => file.startsWith('docs/providers/'));

  it('cover the guide, the browser guide and ParkStay', () => {
    expect(docs).toEqual(
      expect.arrayContaining([
        GUIDE,
        'docs/providers/browser-providers.md',
        'docs/providers/README.md',
        'docs/providers/parkstay/README.md',
      ])
    );
  });

  it.each(docs)('%s has no internal plan, stage, brief or issue references', (file) => {
    const found = readDoc(file)
      .split('\n')
      .flatMap((line, index) =>
        INTERNAL.filter((pattern) => pattern.test(line)).map(
          (pattern) => `${file}:${index + 1} ${pattern}: ${line.trim()}`
        )
      );
    expect(found).toEqual([]);
  });
});

describe("the guide's core timeouts", () => {
  const timeouts = section(readDoc(GUIDE), '### Timeouts');

  it('lists every catalogue and sign-in timing it names with the value in the code', () => {
    // In prose the value comes first, "6 hours (`detailTtlMs`)"; in the table the name does,
    // "`syncTimeoutMs` | 60 s |".
    const named = [...timeouts.matchAll(/(\d+) (s|minutes?|hours?)(?: \(|, )`(\w+Ms)`/g)];
    const rows = [...timeouts.matchAll(/`(\w+Ms)` \| (\d+) (s|minutes?|hours?) \|/g)];
    const values = new Map<string, number>();
    for (const [, amount, unit, name] of named) values.set(name, Number(amount) * UNITS[unit]);
    for (const [, name, amount, unit] of rows) values.set(name, Number(amount) * UNITS[unit]);
    expect([...values.keys()]).toEqual(
      expect.arrayContaining([
        'syncTimeoutMs',
        'detailTimeoutMs',
        'availabilityTimeoutMs',
        'searchTimeoutMs',
        'searchErrorTtlMs',
        'startDelayMs',
        'recheckMs',
        'detailTtlMs',
        'bulkTtlMs',
        'bulkErrorTtlMs',
        'checkTtlMs',
        'probeTimeoutMs',
      ])
    );
    const timings: Record<string, number> = {
      ...(DEFAULT_CATALOG_TIMINGS as unknown as Record<string, number>),
      probeTimeoutMs: DEFAULT_ACCOUNT_TIMINGS.probeTimeoutMs,
    };
    // `timeoutMs` is the SDK's per-request option, checked below.
    values.delete('timeoutMs');
    for (const [name, ms] of values) expect([name, ms]).toEqual([name, timings[name]]);
  });

  it('gives the HTTP and page timeouts the SDK applies', () => {
    expect(timeouts).toContain(`| ${DEFAULT_TIMEOUT_MS / 1000} s (\`timeoutMs\`) |`);
    expect(timeouts).toContain(`| ${DEFAULT_PAGE_TIMEOUT_MS / 1000} s (\`timeoutMs\`) |`);
  });
});

describe('how the docs say a search-mode catalogue is searched', () => {
  const browserGuide = readDoc('docs/providers/browser-providers.md');
  const guide = readDoc(GUIDE);

  it("matches the catalogue service's limits", () => {
    expect(guide).toContain(`at most ${AREA_SEARCH_MAX_PAGES} pages an area`);
    for (const text of [
      `At most ${AREA_SEARCH_MAX_PAGES} pages per area.`,
      `Only the provider's ${AREA_SEARCHES_KEPT} newest area searches`,
      `remembers the last ${SEARCH_MEMORY_SIZE} areas and texts`,
      `at least ${TEXT_SEARCH_MIN_CHARS} characters`,
      `main stores at most ${TEXT_SEARCH_MAX_ITEMS}`,
      `each page has a ${DEFAULT_CATALOG_TIMINGS.searchTimeoutMs / 1000} s deadline`,
      `a failed one not again for ${DEFAULT_CATALOG_TIMINGS.searchErrorTtlMs / 1000} s`,
    ]) {
      expect([text, browserGuide.includes(text)]).toEqual([text, true]);
    }
  });
});

/** The cells of each body row of the table in `text` whose header row starts with `header`. */
function tableRows(text: string, header: string): string[][] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(header));
  if (start < 0) return [];
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim())
    );
  }
  return rows;
}

const unquote = (cell: string): string => cell.replace(/^`|`$/g, '');

describe("the guide's location kinds, stay-field types and bulk availability entries", () => {
  const guide = readDoc(GUIDE);

  it('lists every location kind, in order, with how it reads and what its units are called', () => {
    const rows = tableRows(section(guide, '### Location kinds'), '| Kind |');
    expect(rows.map(([kind]) => unquote(kind))).toEqual([...LOCATION_KINDS]);
    for (const [cell, label, units] of rows) {
      const kind = unquote(cell) as (typeof LOCATION_KINDS)[number];
      expect([kind, label, units]).toEqual([kind, KIND_LABELS[kind], unitNoun(kind).many]);
    }
  });

  it('lists every stay-field type the manifest schema accepts', () => {
    const rows = tableRows(section(guide, '### Stay fields'), '| `type` |');
    expect(rows.map(([type]) => unquote(type))).toEqual(
      StayFieldDescriptorSchema.shape.type.options
    );
  });

  it('documents every field of BulkAvailabilityEntry, in the guide and on the type', () => {
    const file = path.join(ROOT, 'src/shared/types/provider.types.ts');
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.ES2022,
      true
    );
    const entry = source.statements.find(
      (node): node is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(node) && node.name.text === 'BulkAvailabilityEntry'
    );
    expect(entry).toBeDefined();
    const documented = (node: ts.Node): boolean =>
      ts.getJSDocCommentsAndTags(node).some((doc) => ts.isJSDoc(doc) && Boolean(doc.comment));
    expect(documented(entry!)).toBe(true);
    const fields = entry!.members.map((member) => {
      expect([member.name?.getText(), documented(member)]).toEqual([member.name?.getText(), true]);
      return member.name!.getText();
    });
    const rows = tableRows(section(guide, '### Bulk availability entries'), '| Field |');
    expect(rows.map(([field]) => unquote(field))).toEqual(fields);
  });
});

describe('the quick start and the scaffold', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts/new-provider.mjs'), 'utf8');
  const quickStart = section(readDoc(GUIDE), '## Quick start');

  it('starts the guide, before any reference section', () => {
    const guide = readDoc(GUIDE);
    expect(guide.indexOf('## Quick start')).toBeLessThan(guide.indexOf('## Words'));
    expect(quickStart).toContain('npm run provider:new -- ');
  });

  it("uses only the scaffold's own flags", () => {
    const flags = new Set([...script.matchAll(/^\s+'?([a-z-]+)'?: \{ type:/gm)].map((m) => m[1]));
    const used = [...quickStart.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((flag) => !flags.has(flag))).toEqual([]);
    for (const flag of ['api', 'browser', 'search', 'name', 'no-register']) {
      expect([flag, flags.has(flag)]).toEqual([flag, true]);
    }
  });
});

describe("the agents' checklist", () => {
  const claude = readDoc('CLAUDE.md');
  const checklist = section(claude, '## Adding a provider');

  it('is a section of CLAUDE.md naming the scaffold, the files, the gate and the rules', () => {
    for (const text of [
      'npm run provider:new -- <id>',
      'tests/integration/<id>-provider.test.ts',
      'tests/fixtures/providers/<id>/',
      'tests/e2e/fixtures/http/<id>/',
      'BUILT_IN_PROVIDERS',
      'PREVIEW_PROVIDER=<id>',
      'npm test',
      'npm run test:e2e',
      'No live holds',
      'never the live site',
      '**Done** means',
    ]) {
      expect([text, checklist.includes(text)]).toEqual([text, true]);
    }
  });

  it('is what AGENTS.md and /add-provider point to, not a copy', () => {
    const agents = readDoc('AGENTS.md');
    const command = readDoc('.claude/commands/add-provider.md');
    expect(agents).toContain('(CLAUDE.md#adding-a-provider)');
    expect(command).toContain('"Adding a provider" section of `CLAUDE.md`');
    expect(command).toContain('npm run provider:new -- <id>');
    // Pointers, not copies: neither repeats the checklist's rules word for word.
    for (const line of checklist.split('\n').filter((l) => l.length > 120)) {
      expect(agents).not.toContain(line);
      expect(command).not.toContain(line);
    }
  });
});
