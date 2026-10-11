/**
 * `npm run provider:new` (scripts/new-provider.mjs): every kind of provider it generates works
 * as generated.
 *
 * Into a temp copy of what a provider builds on (src/main, src/shared, src/preload, the test
 * helpers and setup, the root configs; node_modules linked, as a junction on Windows) it
 * generates an API provider, a browser provider, and a search-mode catalogue of each, and
 * registers them. Then the copy must type-check (the main tsconfig, plus the generated tests),
 * lint with no warnings, be formatted, and pass the generated tests (the provider contract
 * suite and the mapping) in Jest, and no generated file may name a host that resolves. It also
 * checks what the scaffold refuses, and `--no-register`.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import { PROVIDER_ID_PATTERN } from '@shared/types/provider.types';
import { addDays } from '@shared/utils/calendar-date';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/new-provider.mjs');
const NODE_MODULES = path.join(ROOT, 'node_modules');

/** What a provider and its tests build on: copied into each temp project. */
const COPIED = [
  'src/main',
  'src/shared',
  'src/preload',
  'tests/utils',
  'tests/setup',
  'package.json',
  'tsconfig.json',
  'jest.config.js',
  'eslint.config.js',
  '.prettierrc',
];

interface Variant {
  id: string;
  args: string[];
  kind: 'api' | 'browser';
  search: boolean;
}

/** Ids no real provider takes: the copy includes the providers already in src/main. */
const VARIANTS: Variant[] = [
  { id: 'scaffold-check-api', args: ['--api'], kind: 'api', search: false },
  { id: 'scaffold-check-browser', args: ['--browser'], kind: 'browser', search: false },
  { id: 'scaffold-check-search', args: ['--search'], kind: 'api', search: true },
  {
    id: 'scaffold-check-browser-search',
    args: ['--browser', '--search', '--name', 'Bush & Beach Stays'],
    kind: 'browser',
    search: true,
  },
];

function run(cwd: string, file: string, args: string[]) {
  const env = { ...process.env, FORCE_COLOR: '0' };
  delete env.JEST_WORKER_ID;
  return spawnSync(process.execPath, [file, ...args], { cwd, encoding: 'utf8', env });
}

function scaffold(root: string, ...args: string[]) {
  return run(ROOT, SCRIPT, [...args, '--root', root]);
}

/** A project-relative path with the platform's separators. */
const at = (root: string, file: string): string => path.join(root, ...file.split('/'));

function tempProject(entries: readonly string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-provider-new-'));
  for (const entry of entries) {
    fs.cpSync(at(ROOT, entry), at(root, entry), { recursive: true });
  }
  return root;
}

function removeProject(root: string): void {
  // The link first, so nothing can follow it into the real node_modules.
  fs.rmSync(path.join(root, 'node_modules'), { force: true });
  fs.rmSync(root, { recursive: true, force: true });
}

/** The files a variant generates, project-relative. */
function generatedFiles(variant: Variant): string[] {
  const { id, kind } = variant;
  const provider = [`manifest.ts`, `index.ts`, kind === 'api' ? 'mapping.ts' : 'pages.ts'].map(
    (file) => `src/main/providers/${id}/${file}`
  );
  const fixtures =
    kind === 'api'
      ? [
          `tests/fixtures/providers/${id}/manifest.json`,
          `tests/e2e/fixtures/http/${id}/manifest.json`,
        ]
      : [`tests/fixtures/providers/${id}/site.ts`];
  return [...provider, `tests/integration/${id}-provider.test.ts`, ...fixtures];
}

describe('scripts/new-provider.mjs: generated providers work as generated', () => {
  let root: string;
  const output = new Map<string, string>();
  const tsFiles = (): string[] =>
    VARIANTS.flatMap(generatedFiles).filter((file) => file.endsWith('.ts'));

  beforeAll(() => {
    root = tempProject(COPIED);
    fs.symlinkSync(NODE_MODULES, path.join(root, 'node_modules'), 'junction');
    for (const variant of VARIANTS) {
      const result = scaffold(root, variant.id, ...variant.args);
      if (result.status !== 0) throw new Error(`${variant.id}: ${result.stderr}`);
      output.set(variant.id, result.stdout);
    }
  }, 60_000);

  afterAll(() => {
    if (root) removeProject(root);
  });

  it('writes the files it lists, registers each provider, and prints the next steps', () => {
    const index = fs.readFileSync(at(root, 'src/main/providers/index.ts'), 'utf8');
    for (const variant of VARIANTS) {
      const stdout = output.get(variant.id) ?? '';
      for (const file of generatedFiles(variant)) {
        expect(fs.existsSync(at(root, file))).toBe(true);
        expect(stdout).toContain(file);
      }
      const camel = variant.id.replace(/-(\w)/g, (_all, letter: string) => letter.toUpperCase());
      expect(index).toContain(`import { ${camel}Factory } from './${variant.id}';`);
      expect(index).toMatch(new RegExp(`BUILT_IN_PROVIDERS[^;]*\\b${camel}Factory\\b`));
      expect(stdout).toContain('Registered in src/main/providers/index.ts');
      expect(stdout).toContain(`npx jest tests/integration/${variant.id}-provider.test.ts`);
      expect(stdout).toContain('npm run test:e2e');
      expect(stdout).toMatch(/CLAUDE\.md, "Adding a provider"/);
      // A sign-in added later needs a route for its check; a browser provider is previewed by hand.
      if (variant.kind === 'api') {
        expect(stdout).toContain(
          `signed-out answer in tests/e2e/fixtures/http/${variant.id}/manifest.json, or the app's check is\n     refused and the preview fails`
        );
        expect(stdout).toContain(`PREVIEW_PROVIDER=${variant.id}`);
        // The preview's example arrival is one the generated e2e responses cover, both nights.
        const arrival = /PREVIEW_ARRIVAL=(\d{4}-\d{2}-\d{2})\b/.exec(stdout)?.[1];
        expect(arrival).toBeDefined();
        const sample = fs.readFileSync(
          at(root, `tests/e2e/fixtures/http/${variant.id}/availability-1001.json`),
          'utf8'
        );
        for (const night of [arrival!, addDays(arrival!, 1)]) {
          expect([night, sample.includes(`"date": "${night}"`)]).toEqual([night, true]);
        }
      } else {
        expect(stdout).toContain(
          `its signed-in check goes through\n     ctx.http, which fixture mode answers only from tests/e2e/fixtures/http/${variant.id}/`
        );
        expect(stdout).not.toContain('the preview fails');
        expect(stdout).toContain(`node scripts/serve-provider-site.mjs ${variant.id}`);
      }
    }
    // ParkStay stays first, and registered.
    expect(index).toMatch(
      /BUILT_IN_PROVIDERS: readonly ProviderFactory\[\] = \[\s*parkstayFactory,/
    );
  });

  it('writes the manifest with every capability spelled out, and the right mode', () => {
    for (const variant of VARIANTS) {
      const manifest = fs.readFileSync(
        at(root, `src/main/providers/${variant.id}/manifest.ts`),
        'utf8'
      );
      for (const capability of [
        'catalog',
        'catalogMode',
        'availability',
        'bulkAvailability',
        'watches',
        'snipes',
        'holds',
        'bookingImport',
        'accessGate',
        'account',
      ]) {
        expect(manifest).toMatch(new RegExp(`\\n {4}${capability}: `));
      }
      expect(manifest).toContain(`catalogMode: '${variant.search ? 'search' : 'full'}'`);
      const index = fs.readFileSync(at(root, `src/main/providers/${variant.id}/index.ts`), 'utf8');
      // A search-mode catalogue searches by area, and (optionally) by name.
      expect(/\bsearchArea\b/.test(index)).toBe(variant.search);
      expect(/\bsearchText\b/.test(index)).toBe(variant.search);
      expect(/\blistLocations\b/.test(index)).toBe(!variant.search);
      expect(manifest).toContain(`integration: '${variant.kind}'`);
    }
    expect(
      fs.readFileSync(
        at(root, 'src/main/providers/scaffold-check-browser-search/manifest.ts'),
        'utf8'
      )
    ).toContain("name: 'Bush & Beach Stays'");
  });

  it('type-checks: the main tsconfig over the copy, and the generated tests', () => {
    const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
    const { options, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    const tests = VARIANTS.map((v) => at(root, `tests/integration/${v.id}-provider.test.ts`));
    const program = ts.createProgram([...fileNames, ...tests], {
      ...options,
      noEmit: true,
      types: ['node', 'jest'],
      paths: { ...options.paths, '@tests/*': ['./tests/*'] },
    });
    const errors = ts.getPreEmitDiagnostics(program).map((d) => {
      const where = d.file ? path.relative(root, d.file.fileName) : '';
      return `${where}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    });
    expect(errors).toEqual([]);
  }, 120_000);

  it('lints with no errors or warnings', () => {
    const result = run(root, path.join(NODE_MODULES, 'eslint/bin/eslint.js'), [
      '--max-warnings',
      '0',
      'src/main/providers/index.ts',
      ...tsFiles(),
    ]);
    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  }, 120_000);

  it('is formatted as Prettier formats it', () => {
    const result = run(root, path.join(NODE_MODULES, 'prettier/bin/prettier.cjs'), [
      '--check',
      'src/main/providers/index.ts',
      ...tsFiles(),
    ]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  }, 60_000);

  it('passes its own tests: the provider contract suite and the mapping', () => {
    const results = path.join(root, 'jest-results.json');
    const result = run(root, path.join(NODE_MODULES, 'jest/bin/jest.js'), [
      '--ci',
      '--selectProjects',
      'main',
      '--watchman=false',
      '--maxWorkers=2',
      '--json',
      '--outputFile',
      results,
      // A pattern, not a flag: one starting with '-' would be read as short options.
      'provider\\.test\\.ts$',
    ]);
    const report = fs.existsSync(results)
      ? (JSON.parse(fs.readFileSync(results, 'utf8')) as {
          numFailedTests: number;
          numPassedTests: number;
          testResults: {
            name: string;
            assertionResults: { ancestorTitles: string[]; status: string }[];
          }[];
        })
      : undefined;
    if (!report || result.status !== 0) throw new Error(result.stderr || result.stdout);
    expect(report.numFailedTests).toBe(0);
    for (const variant of VARIANTS) {
      const file = report.testResults.find((r) =>
        r.name.endsWith(`${variant.id}-provider.test.ts`)
      );
      const contract = (file?.assertionResults ?? []).filter((a) =>
        a.ancestorTitles.includes(`provider contract: ${variant.id}`)
      );
      expect([variant.id, contract.length > 10]).toEqual([variant.id, true]);
      expect(file?.assertionResults.every((a) => a.status === 'passed')).toBe(true);
    }
  }, 240_000);

  it('names only hosts that never resolve (.invalid, .test, example.com)', () => {
    const reserved = /(?:\.invalid|\.test|(?:^|\.)example\.com)$/;
    const hosts = VARIANTS.flatMap(generatedFiles)
      .flatMap((file) => {
        const text = fs.readFileSync(at(root, file), 'utf8');
        return [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
      })
      .filter((host) => !reserved.test(host) && host !== '127.0.0.1');
    expect(hosts).toEqual([]);
  });
});

describe('scripts/new-provider.mjs: what it refuses', () => {
  let root: string;

  beforeEach(() => {
    // Just enough of a project: the built-in list, ParkStay, the SDK and the registry.
    root = tempProject(['src/main/providers/index.ts', 'src/main/providers/registry.ts']);
    fs.mkdirSync(at(root, 'src/main/providers/parkstay'), { recursive: true });
    fs.mkdirSync(at(root, 'src/main/providers/sdk'), { recursive: true });
  });

  afterEach(() => removeProject(root));

  /** Every file under `root`, project-relative. */
  const filesIn = (dir: string): string[] =>
    fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)));

  it.each([
    ['Acme', 'not a valid provider id'],
    ['a', 'not a valid provider id'],
    ['1parks', 'not a valid provider id'],
    ['acme_parks', 'not a valid provider id'],
    ['x'.repeat(33), 'not a valid provider id'],
    ['acme-', 'no hyphen at the end'],
    ['acme--parks', 'two in a row'],
    ['parkstay', 'already exists'],
    ['sdk', 'already exists'],
    ['registry', 'already exists'],
  ])('refuses the id %p (%s), and writes nothing', (id, message) => {
    const before = filesIn(root);
    const result = scaffold(root, id);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain('Usage: npm run provider:new');
    expect(filesIn(root)).toEqual(before);
  });

  it.each([
    [['scaffold-check-other', '--api', '--browser'], 'Choose --api or --browser, not both'],
    [['scaffold-check-other', 'scaffold-check-second'], 'exactly one provider id'],
    [[], 'exactly one provider id'],
    [['scaffold-check-other', '--sql'], "Unknown option '--sql'"],
    [['scaffold-check-other', '--name', 'Acme <Parks>'], 'not a usable name'],
  ])('refuses %p', (args, message) => {
    const result = scaffold(root, ...args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it('refuses an id whose test or fixtures are already there', () => {
    fs.mkdirSync(at(root, 'tests/fixtures/providers/scaffold-check-other'), { recursive: true });
    const result = scaffold(root, 'scaffold-check-other');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tests/fixtures/providers/scaffold-check-other');
  });

  it('with --no-register, leaves the built-in list alone and prints the lines to add', () => {
    const index = fs.readFileSync(at(root, 'src/main/providers/index.ts'), 'utf8');
    const result = scaffold(root, 'scaffold-check-other', '--no-register');
    expect(result.status).toBe(0);
    expect(fs.readFileSync(at(root, 'src/main/providers/index.ts'), 'utf8')).toBe(index);
    expect(result.stdout).toContain(
      "import { scaffoldCheckOtherFactory } from './scaffold-check-other';"
    );
    expect(result.stdout).toContain('add scaffoldCheckOtherFactory to BUILT_IN_PROVIDERS');
    expect(fs.existsSync(at(root, 'src/main/providers/scaffold-check-other/index.ts'))).toBe(true);
  });

  it('prints its usage for --help', () => {
    const result = scaffold(root, '--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: npm run provider:new -- <id>');
    expect(filesIn(root).length).toBe(2);
  });
});

describe('scripts/new-provider.mjs: registering, naming and undoing', () => {
  let root: string;
  const index = (): string => at(root, 'src/main/providers/index.ts');
  const provider = (file: string): string =>
    at(root, `src/main/providers/scaffold-check-other/${file}`);

  beforeEach(() => {
    root = tempProject(['src/main/providers/index.ts', 'src/main/providers/registry.ts']);
  });

  afterEach(() => removeProject(root));

  it('registers into an empty built-in list', () => {
    fs.writeFileSync(index(), fs.readFileSync(index(), 'utf8').replace(/= \[[^\]]*\];/, '= [];'));
    const result = scaffold(root, 'scaffold-check-other');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Registered in src/main/providers/index.ts');
    expect(fs.readFileSync(index(), 'utf8')).toMatch(
      /BUILT_IN_PROVIDERS: readonly ProviderFactory\[\] = \[\s*scaffoldCheckOtherFactory,?\s*\];/
    );
  });

  it('writes one full stop after a name that ends in one', () => {
    const result = scaffold(root, 'scaffold-check-other', '--name', 'Acme Parks Co.');
    expect(result.status).toBe(0);
    expect(fs.readFileSync(provider('manifest.ts'), 'utf8')).toContain(
      "description: 'Places to stay from Acme Parks Co.',"
    );
  });

  it('undoes a run that fails partway, folders included, so it can be run again', () => {
    // A file where the fixtures folder goes: the provider and its test are written first.
    fs.mkdirSync(at(root, 'tests/fixtures'), { recursive: true });
    fs.writeFileSync(at(root, 'tests/fixtures/providers'), 'in the way');
    const failed = scaffold(root, 'scaffold-check-other', '--no-register');
    expect(failed.status).toBe(1);
    // With the run's own output, so a failure on another platform says why.
    const left = ['src/main/providers/scaffold-check-other', 'tests/integration'].filter((dir) =>
      fs.existsSync(at(root, dir))
    );
    expect({ left, stderr: failed.stderr }).toEqual({ left: [], stderr: expect.any(String) });

    fs.rmSync(at(root, 'tests/fixtures/providers'));
    const again = scaffold(root, 'scaffold-check-other', '--no-register');
    expect(again.status).toBe(0);
    expect(fs.existsSync(provider('index.ts'))).toBe(true);
  });
});

describe('scripts/new-provider.mjs: wiring', () => {
  it("checks ids with the registry's own rule", () => {
    const source = fs.readFileSync(SCRIPT, 'utf8');
    const pattern = /const PROVIDER_ID_PATTERN = \/(.+)\/;/.exec(source)?.[1];
    expect(pattern).toBe(PROVIDER_ID_PATTERN.source);
  });

  it('is `npm run provider:new`', () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(scripts['provider:new']).toBe('node scripts/new-provider.mjs');
  });
});
