/**
 * @jest-environment node
 *
 * Every relative link and image in the docs resolves (README.md, CLAUDE.md, AGENTS.md, the
 * agent commands in .claude/commands, CHANGELOG.md, docs/**, resources/** and tests/README.md),
 * anchors included; every image has alt text; and every backticked `src/…`, `tests/…` or
 * `docs/…` path in the agents' instructions exists. External URLs are not fetched.
 */

import fs from 'fs';
import path from 'path';
import { agentDocs, anchorsIn, docFiles, linksIn, readDoc, ROOT, slug } from './markdown';

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** `file:line target: problem` for each link of `file` that does not resolve. */
function brokenLinks(file: string): string[] {
  const text = readDoc(file);
  const problems: string[] = [];
  for (const link of linksIn(text)) {
    const where = `${file}:${link.line} ${link.target}`;
    if (link.kind === 'image' && !link.alt?.trim())
      problems.push(`${where}: image without alt text`);
    if (!link.target) {
      problems.push(`${where}: empty target`);
      continue;
    }
    if (EXTERNAL.test(link.target)) continue;
    const [pathPart, anchor] = link.target.split('#', 2) as [string, string | undefined];
    const decoded = decodeURIComponent(pathPart.split('?')[0]);
    // Site-absolute links do not work on GitHub for files in the repository.
    if (decoded.startsWith('/')) {
      problems.push(`${where}: absolute path`);
      continue;
    }
    const resolved = decoded
      ? path.resolve(path.dirname(path.join(ROOT, file)), decoded)
      : path.join(ROOT, file);
    if (!fs.existsSync(resolved)) {
      problems.push(`${where}: no such file`);
      continue;
    }
    if (anchor && resolved.endsWith('.md') && fs.statSync(resolved).isFile()) {
      const anchors = anchorsIn(fs.readFileSync(resolved, 'utf8').replace(/\r\n/g, '\n'));
      if (!anchors.has(anchor)) problems.push(`${where}: no heading #${anchor}`);
    }
  }
  return problems;
}

describe('docs links', () => {
  const files = docFiles();

  it('covers the README, CLAUDE.md, CHANGELOG, docs/, resources/ and tests/README.md', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'README.md',
        'CLAUDE.md',
        'AGENTS.md',
        '.claude/commands/add-provider.md',
        'CHANGELOG.md',
        'tests/README.md',
        'docs/README.md',
        'resources/README.md',
      ])
    );
    expect(files.filter((f) => f.startsWith('docs/')).length).toBeGreaterThan(15);
  });

  it.each(docFiles())('%s: every relative link and image resolves and has alt text', (file) => {
    expect(brokenLinks(file)).toEqual([]);
  });
});

describe('the link checker itself', () => {
  it('reads links, images and anchors, and ignores code', () => {
    const text = [
      '# Getting started',
      '## The `HttpClient` (and you)',
      '## Getting started',
      'See [a](docs/x.md#y "title") and ![logo](img.png) and <img src="b.png" alt="">',
      '```md',
      '[not a link](nowhere.md)',
      '```',
      'and `[inline](nowhere.md)` too.',
    ].join('\n');
    expect(linksIn(text).map((l) => [l.kind, l.target, l.alt])).toEqual([
      ['link', 'docs/x.md#y', undefined],
      ['image', 'img.png', 'logo'],
      ['image', 'b.png', ''],
    ]);
    expect([...anchorsIn(text)]).toEqual([
      'getting-started',
      'the-httpclient-and-you',
      'getting-started-1',
    ]);
    expect(slug('Upgrading from WA ParkStay Bookings')).toBe('upgrading-from-wa-parkstay-bookings');
    expect(slug("Search-mode catalogues (`catalogMode: 'search'`)")).toBe(
      'search-mode-catalogues-catalogmode-search'
    );
  });
});

describe("the agents' instructions", () => {
  it('include CLAUDE.md, AGENTS.md and the agent commands', () => {
    expect(agentDocs()).toEqual(
      expect.arrayContaining([
        'CLAUDE.md',
        'AGENTS.md',
        '.claude/commands/add-provider.md',
        '.claude/commands/release.md',
      ])
    );
  });

  it.each(agentDocs())('%s names only paths that exist', (file) => {
    // Backticked paths under src/, tests/ or docs/; placeholders and globs are not paths.
    const text = readDoc(file);
    const spans = [...text.matchAll(/`((?:src|tests|docs)\/[^`\s]*)`/g)].map((m) => m[1]);
    if (file === 'CLAUDE.md') expect(spans.length).toBeGreaterThan(20);
    const missing = spans
      .filter((span) => !/[<*{]/.test(span))
      .map((span) => span.replace(/[.,:;)]+$/, ''))
      .filter((span) => !fs.existsSync(path.join(ROOT, span)));
    expect(missing).toEqual([]);
  });
});
