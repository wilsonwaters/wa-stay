#!/usr/bin/env node
/**
 * `npm run provider:new -- <id> [--api | --browser] [--search] [--name "<name>"] [--no-register]`
 *
 * Generates a working provider to start from: a module in `src/main/providers/<id>/` (a manifest
 * with every capability spelled out, and the modules), sample fixtures, and a Jest test that runs
 * the provider contract suite and checks the mapping. Everything passes as generated: lint,
 * format, type-check, `npm test` and the e2e suite. Then it adds the provider to
 * `BUILT_IN_PROVIDERS` (or, with `--no-register`, prints the lines to add) and prints the next
 * steps.
 *
 * - `--api` (the default): JSON over `ctx.http`. Also writes `tests/e2e/fixtures/http/<id>/`, the
 *   recorded responses fixture mode serves in the app.
 * - `--browser`: the provider's website read through `ctx.browser`, with a made-up site in
 *   `tests/fixtures/providers/<id>/site.ts` for the fake browser.
 * - `--search`: `catalogMode: 'search'` with `catalog.searchArea` (and an optional
 *   `catalog.searchText`, by name), for a catalogue too big to list.
 * - `--name`: the provider's display name (default: from the id, `acme-parks` → "Acme Parks").
 * - `--root <dir>`: the project to write into (default: this repository). For tests.
 *
 * The generated provider never contacts a real site: its addresses start empty, and until they
 * are set every call fails with a ProviderError that says which constant to set. Sample data
 * uses `.invalid` and `.test` hosts, which never resolve.
 *
 * Templates: `scripts/templates/provider/*.tpl`, with `{{TOKEN}}` placeholders and whole-line
 * `// @if <api|browser|search|full>`, `// @else`, `// @endif` blocks. Plain Node, no
 * dependencies; the generated files are formatted with the project's Prettier.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = path.join(REPO, 'scripts', 'templates', 'provider');

/**
 * The registry's provider id rule (`PROVIDER_ID_PATTERN`, src/shared/types/provider.types.ts);
 * tests/scripts/new-provider.test.ts keeps the two the same.
 */
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const ID_RULE = '2–32 lower-case letters, digits or hyphens, starting with a letter';
/** A display name: letters, digits, spaces and a little punctuation. */
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} &'.,()-]{0,59}$/u;
/** Dark colours that white text passes WCAG AA on (contrast at least 4.5:1). */
const BRAND_COLOURS = ['#1F5A7A', '#7A3B1F', '#2E6B3A', '#5B3A7A', '#7A1F4B', '#6B5A1F'];
/**
 * An arrival the sample responses cover (`scripts/templates/provider/api-fixtures`, nights
 * 9–12 Nov 2026), for the preview's `PREVIEW_ARRIVAL`; tests/scripts/new-provider.test.ts checks
 * the generated e2e responses cover it.
 */
const SAMPLE_ARRIVAL = '2026-11-10';

const USAGE = `Usage: npm run provider:new -- <id> [--api | --browser] [--search] [--name "<name>"] [--no-register]

  <id>           The provider id: ${ID_RULE}. It is stored in user data, so it never changes.
  --api          An API provider: JSON over ctx.http (the default).
  --browser      A browser provider: its website read through ctx.browser.
  --search       A search-mode catalogue (catalog.searchArea, and optional searchText), for one too big to list.
  --name <name>  The display name (default: from the id).
  --no-register  Do not edit src/main/providers/index.ts; print the lines to add instead.
  --root <dir>   The project to write into (default: this repository; for tests).`;

class UsageError extends Error {}

function fail(message) {
  throw new UsageError(message);
}

/** The project-relative path, with forward slashes. */
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        api: { type: 'boolean', default: false },
        browser: { type: 'boolean', default: false },
        search: { type: 'boolean', default: false },
        name: { type: 'string' },
        'no-register': { type: 'boolean', default: false },
        root: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    fail(error.message);
  }
  const { values, positionals } = parsed;
  if (values.help) return { help: true };
  if (positionals.length !== 1) fail('Give exactly one provider id.');
  if (values.api && values.browser) fail('Choose --api or --browser, not both.');
  const id = positionals[0];
  if (!PROVIDER_ID_PATTERN.test(id)) fail(`"${id}" is not a valid provider id: use ${ID_RULE}.`);
  if (id.endsWith('-') || id.includes('--')) {
    fail(`"${id}" is not a good provider id: no hyphen at the end or two in a row.`);
  }
  const name = values.name?.trim() || titleOf(id);
  if (!NAME_PATTERN.test(name)) {
    fail(`"${name}" is not a usable name: letters, digits, spaces and & ' . , ( ) - only.`);
  }
  return {
    id,
    name,
    kind: values.browser ? 'browser' : 'api',
    search: values.search,
    register: !values['no-register'],
    root: path.resolve(values.root ?? REPO),
  };
}

function titleOf(id) {
  return id
    .split('-')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function namesOf({ id, name }) {
  const words = id.split('-').filter(Boolean);
  const pascal = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  const nameWords = name.split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''));
  const initials = nameWords
    .filter(Boolean)
    .map((word) => word[0].toUpperCase())
    .join('')
    .replace(/[^A-Z0-9]/g, '');
  const monogram = (initials.length >= 2 ? initials : pascal.replace(/[^A-Za-z0-9]/g, ''))
    .slice(0, initials.length >= 2 ? 3 : 2)
    .toUpperCase();
  const shortName = name.length <= 24 ? name : name.slice(0, 24).trimEnd();
  const hash = [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const js = (text) => text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const htmlText = (text) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    ID: id,
    NAME: name,
    NAME_JS: js(name),
    DESCRIPTION_JS: js(`Places to stay from ${name.replace(/\.+$/, '')}.`),
    NAME_HTML: htmlText(name),
    SHORT_NAME_JS: js(shortName),
    PASCAL: pascal,
    CAMEL: pascal[0].toLowerCase() + pascal.slice(1),
    CONST: words.join('_').toUpperCase(),
    MONOGRAM: monogram || 'P',
    COLOR: BRAND_COLOURS[hash % BRAND_COLOURS.length],
  };
}

/** Keeps the lines of `// @if <flag>` blocks whose flag is on, and fills in `{{TOKEN}}`s. */
function render(template, tokens, flags) {
  const out = [];
  const stack = [];
  const lines = template.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const marker = /^\s*\/\/ @(if|else|endif)\b\s*(\S*)\s*$/.exec(line);
    if (marker) {
      const [, word, flag] = marker;
      if (word === 'if') stack.push({ on: Boolean(flags[flag]), inElse: false });
      else if (word === 'else') stack.at(-1).inElse = true;
      else stack.pop();
      continue;
    }
    if (stack.every((block) => block.on !== block.inElse)) out.push(line);
  }
  if (stack.length) throw new Error('A template has an // @if without its // @endif');
  const text = out.join('\n').replace(/\{\{(\w+)\}\}/g, (all, token) => {
    if (!(token in tokens)) throw new Error(`A template uses an unknown token ${all}`);
    return tokens[token];
  });
  return text;
}

function template(name, tokens, flags) {
  return render(fs.readFileSync(path.join(TEMPLATES, name), 'utf8'), tokens, flags);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The sample responses of an API provider, and the routes that serve them. */
function apiFixtures(tokens, { search, forJest }) {
  const read = (file) => JSON.parse(template(`api-fixtures/${file}.json.tpl`, tokens, {}));
  const files = {};
  const routes = [];
  if (search) {
    files['search-1.json'] = json({
      locations: [read('place-1001'), read('place-1002')],
      nextPage: 2,
    });
    files['search-2.json'] = json({ locations: [read('place-1003'), read('place-1004')] });
    files['find-banksia.json'] = json({ locations: [read('place-1001')] });
    routes.push(
      { method: 'GET', path: '/search', query: { page: '1' }, file: 'search-1.json' },
      { method: 'GET', path: '/search', query: { page: '2' }, file: 'search-2.json' },
      // Searches by name: in the app, any name finds the sample place.
      forJest
        ? { method: 'GET', path: '/find', query: { text: 'Banksia' }, file: 'find-banksia.json' }
        : { method: 'GET', path: '/find', file: 'find-banksia.json' }
    );
  } else {
    const places = ['1001', '1002', '1003'].map((place) => read(`place-${place}`));
    files['locations.json'] = json({ locations: places });
    routes.push({ method: 'GET', path: '/locations', file: 'locations.json' });
  }
  for (const place of ['1001', '1002', '1003']) {
    files[`location-${place}.json`] = json(read(`location-${place}`));
    files[`availability-${place}.json`] = json(read(`availability-${place}`));
    routes.push(
      { method: 'GET', path: `/locations/${place}`, file: `location-${place}.json` },
      {
        method: 'GET',
        path: `/locations/${place}/availability`,
        file: `availability-${place}.json`,
      }
    );
  }
  if (forJest) {
    // A place the API does not know: a 404, for the contract suite and the mapping test.
    files['not-found.json'] = json(read('not-found'));
    for (const route of ['/locations/does-not-exist', '/locations/does-not-exist/availability']) {
      routes.push({ method: 'GET', path: route, status: 404, file: 'not-found.json' });
    }
  }
  files['manifest.json'] = json({ routes });
  return files;
}

/** Every file to write, by project-relative path. */
function filesFor(options, tokens) {
  const { id, kind, search } = options;
  const flags = { api: kind === 'api', browser: kind === 'browser', search, full: !search };
  const providerDir = `src/main/providers/${id}`;
  const files = {
    [`${providerDir}/manifest.ts`]: template('manifest.ts.tpl', tokens, flags),
    [`${providerDir}/index.ts`]: template(`${kind}-index.ts.tpl`, tokens, flags),
    [`tests/integration/${id}-provider.test.ts`]: template(
      `${kind}-provider.test.ts.tpl`,
      tokens,
      flags
    ),
  };
  if (kind === 'api') {
    files[`${providerDir}/mapping.ts`] = template('api-mapping.ts.tpl', tokens, flags);
    for (const [name, text] of Object.entries(apiFixtures(tokens, { search, forJest: true }))) {
      files[`tests/fixtures/providers/${id}/${name}`] = text;
    }
    for (const [name, text] of Object.entries(apiFixtures(tokens, { search, forJest: false }))) {
      files[`tests/e2e/fixtures/http/${id}/${name}`] = text;
    }
  } else {
    files[`${providerDir}/pages.ts`] = template('browser-pages.ts.tpl', tokens, flags);
    files[`tests/fixtures/providers/${id}/site.ts`] = template(
      'browser-site.ts.tpl',
      tokens,
      flags
    );
  }
  return files;
}

const INDEX = 'src/main/providers/index.ts';
const LIST = /export const BUILT_IN_PROVIDERS: readonly ProviderFactory\[\] = \[([^\]]*)\];/;

function refuseExisting(root, id, files) {
  const providers = path.join(root, 'src', 'main', 'providers');
  if (!fs.existsSync(path.join(root, INDEX))) {
    fail(`${INDEX} is not in ${root}: run this from the WA Stay repository.`);
  }
  for (const entry of [id, `${id}.ts`]) {
    if (fs.existsSync(path.join(providers, entry))) {
      fail(`src/main/providers/${entry} already exists: "${id}" is taken. Choose another id.`);
    }
  }
  if (new RegExp(`from '\\./${id}'`).test(fs.readFileSync(path.join(root, INDEX), 'utf8'))) {
    fail(`${INDEX} already imports "./${id}". Choose another id.`);
  }
  const taken = Object.keys(files).filter((file) => fs.existsSync(path.join(root, file)));
  const dirs = [`tests/fixtures/providers/${id}`, `tests/e2e/fixtures/http/${id}`].filter((dir) =>
    fs.existsSync(path.join(root, dir))
  );
  if (taken.length || dirs.length) {
    fail(`These already exist, so "${id}" looks taken:\n  ${[...dirs, ...taken].join('\n  ')}`);
  }
}

function registrationLines(tokens) {
  return {
    importLine: `import { ${tokens.CAMEL}Factory } from './${tokens.ID}';`,
    factory: `${tokens.CAMEL}Factory`,
  };
}

/** Adds the import and the factory to BUILT_IN_PROVIDERS; false when the file has changed shape. */
function register(root, tokens) {
  const file = path.join(root, INDEX);
  const text = fs.readFileSync(file, 'utf8');
  const { importLine, factory } = registrationLines(tokens);
  const list = LIST.exec(text);
  const imports = [...text.matchAll(/^import \{ \w+ \} from '\.\/[\w-]+';$/gm)];
  if (!list || imports.length === 0) return false;
  const lastImport = imports.at(-1);
  const at = lastImport.index + lastImport[0].length;
  const entries = list[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  // Written whole: replacing inside the old line mis-edits an empty list ('' matches at once).
  const newList = `export const BUILT_IN_PROVIDERS: readonly ProviderFactory[] = [${[...entries, factory].join(', ')}];`;
  const updated = `${text.slice(0, at)}\n${importLine}${text.slice(at)}`.replace(list[0], newList);
  fs.writeFileSync(file, updated);
  return true;
}

/** Formats `files` with the project's Prettier, as `npm run format` would. */
function format(root, files) {
  const require = createRequire(path.join(REPO, 'package.json'));
  let bin;
  try {
    bin = path.join(path.dirname(require.resolve('prettier')), 'bin', 'prettier.cjs');
  } catch {
    return {
      failed: false,
      message: 'Prettier is not installed (run npm ci), so the files are not formatted.',
    };
  }
  const config = fs.existsSync(path.join(root, '.prettierrc'))
    ? path.join(root, '.prettierrc')
    : path.join(REPO, '.prettierrc');
  const result = spawnSync(
    process.execPath,
    [bin, '--write', '--log-level', 'warn', '--config', config, ...files],
    { cwd: root, encoding: 'utf8' }
  );
  return result.status === 0
    ? undefined
    : { failed: true, message: `Prettier failed:\n${result.stderr || result.stdout}` };
}

function nextSteps(options, tokens, registered) {
  const { id, kind } = options;
  const where = `src/main/providers/${id}`;
  const fill =
    kind === 'api'
      ? `Set ${tokens.CONST}_API_URL and ${tokens.CONST}_SITE_URL in ${where}/index.ts, then work
     through every TODO: the request paths, the raw shapes in mapping.ts, and real recorded
     responses in tests/fixtures/providers/${id}/ and tests/e2e/fixtures/http/${id}/.`
      : `Set ${tokens.CONST}_SITE_URL in ${where}/index.ts, then work through every TODO: the
     site's paths, labels and attributes in pages.ts, and a trimmed copy of its markup in
     tests/fixtures/providers/${id}/site.ts.`;
  const preview =
    kind === 'api'
      ? `npm run build:e2e
     npx cross-env PREVIEW_PROVIDER=${id} playwright test preview-provider   (Linux: xvfb-run -a npx ...)
     It checks availability for tomorrow, which the sample responses do not cover (it warns):
     add PREVIEW_ARRIVAL=${SAMPLE_ARRIVAL} for dates they do, or your recorded responses' dates.`
      : `Fixture mode serves ctx.http only, so preview it by hand against its made-up site on
     loopback: node scripts/serve-provider-site.mjs ${id}, then set ${tokens.CONST}_SITE_URL to
     the address it prints, for the preview only ("Preview in the app" in
     docs/providers/browser-providers.md).`;
  // The scaffold writes `account: 'none'`; a sign-in added later is checked through ctx.http,
  // which fixture mode answers only from tests/e2e/fixtures/http/<id>/.
  const account =
    kind === 'api'
      ? `If you add a sign-in (an account other than 'none'), give its signed-in check a
     signed-out answer in tests/e2e/fixtures/http/${id}/manifest.json, or the app's check is
     refused and the preview fails.`
      : `If you add a sign-in (an account other than 'none'), its signed-in check goes through
     ctx.http, which fixture mode answers only from tests/e2e/fixtures/http/${id}/: add that
     folder, with a manifest.json and a signed-out answer for the check, before you preview it
     by hand, or the check is refused and logged.`;
  return `
Next steps (CLAUDE.md, "Adding a provider", is the checklist):
  1. Read the provider's terms of use: no automated access means links only.
  2. ${fill}
     ${account}
  3. Run its tests (the contract suite and the mapping):
     npx jest tests/integration/${id}-provider.test.ts
  4. Preview it in the app:
     ${preview}
  5. ${registered ? 'It is registered.' : 'Register it (above).'} Run the full gate before you call it done:
     npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz
     npm run build:e2e && npm run test:e2e   (Linux: xvfb-run -a npm run test:e2e)
  Never place a real hold, booking or payment, and never point a test at the live site.`;
}

function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const { id, name, kind, search, root } = options;
  const tokens = namesOf(options);
  const files = filesFor(options, tokens);
  refuseExisting(root, id, files);

  const written = [];
  const madeDirs = [];
  try {
    for (const [file, text] of Object.entries(files)) {
      const target = path.join(root, file);
      // The folders this run makes, found before making them: mkdirSync's own answer is not
      // comparable with path.join's on Windows.
      for (let dir = path.dirname(target); !fs.existsSync(dir); dir = path.dirname(dir)) {
        madeDirs.push(dir);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text.endsWith('\n') ? text : `${text}\n`, { flag: 'wx' });
      written.push(target);
    }
  } catch (error) {
    // Undo it all, so a second try is not refused as "taken".
    for (const target of written) fs.rmSync(target, { force: true });
    for (const dir of [...new Set(madeDirs)].sort((a, b) => b.length - a.length)) {
      // Made by this run, so all it holds is what this run wrote. Windows may hold a file
      // briefly after a write (an indexer, a virus scan): retry rather than leave it behind.
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
    throw error;
  }

  const registered = options.register && register(root, tokens);
  const toFormat = written.filter((file) => file.endsWith('.ts'));
  if (registered) toFormat.push(path.join(root, INDEX));
  const formatProblem = format(root, toFormat);

  const label = `${kind === 'api' ? 'an API' : 'a browser'} provider${search ? ' with a search-mode catalogue' : ''}`;
  console.log(`Created ${name} (${id}), ${label}:`);
  for (const file of written) console.log(`  ${rel(root, file)}`);
  if (registered) {
    console.log(`Registered in ${INDEX} (BUILT_IN_PROVIDERS).`);
  } else {
    const { importLine, factory } = registrationLines(tokens);
    const why = options.register ? `${INDEX} has changed shape, so` : 'With --no-register';
    console.log(`${why} it is not registered. To register it, add to ${INDEX}:
  ${importLine}
and add ${factory} to BUILT_IN_PROVIDERS.`);
  }
  console.log(nextSteps(options, tokens, registered));
  if (formatProblem?.failed) {
    console.error(`provider:new: ${formatProblem.message}
The files above are written but not formatted; fix what Prettier reports (in ${INDEX} too if it
is named) before running the gate.`);
    process.exitCode = 1;
  } else if (formatProblem) {
    console.warn(formatProblem.message);
  }
}

try {
  main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`provider:new: ${error.message}\n\n${USAGE}`);
  } else {
    console.error(`provider:new: ${error.stack ?? error}`);
  }
  process.exitCode = 1;
}
