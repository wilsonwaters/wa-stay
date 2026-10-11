/**
 * Reading the repository's Markdown for the docs tests: which files count as docs, their
 * links, images and headings (as GitHub turns them into anchors), with code left out.
 */

import fs from 'fs';
import path from 'path';

export const ROOT = path.resolve(__dirname, '../../..');

const rel = (file: string): string => path.relative(ROOT, file).split(path.sep).join('/');

function markdownUnder(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownUnder(child);
    return entry.name.endsWith('.md') ? [child.split(path.sep).join('/')] : [];
  });
}

/** The instructions for AI agents: CLAUDE.md, AGENTS.md and the agent commands. */
export function agentDocs(): string[] {
  return ['CLAUDE.md', 'AGENTS.md', ...markdownUnder('.claude/commands')].filter((file) =>
    fs.existsSync(path.join(ROOT, file))
  );
}

/** Every doc the link check covers, relative to the repository root. */
export function docFiles(): string[] {
  return [
    'README.md',
    ...agentDocs(),
    'CHANGELOG.md',
    'tests/README.md',
    ...markdownUnder('docs'),
    ...markdownUnder('resources'),
  ].filter((file) => fs.existsSync(path.join(ROOT, file)));
}

export function readDoc(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
}

/** The text with fenced code blocks blanked out (line numbers kept). */
export function withoutFences(text: string): string {
  let fence: string | null = null;
  return text
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence === null && marker) {
        fence = marker;
        return '';
      }
      if (fence !== null) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        return '';
      }
      return line;
    })
    .join('\n');
}

/** The text with fenced code and inline code spans blanked out. */
export function prose(text: string): string {
  return withoutFences(text).replace(/(`+)[^`\n]*?\1/g, (span) => ' '.repeat(span.length));
}

export interface DocLink {
  kind: 'link' | 'image';
  target: string;
  /** Alt text, for images. */
  alt?: string;
  line: number;
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** Markdown and HTML links and images, outside code. */
export function linksIn(text: string): DocLink[] {
  const body = prose(text);
  const links: DocLink[] = [];
  // ![alt](target "title") and [text](target "title"); the target may be <wrapped>.
  const markdown = /(!?)\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
  for (const match of body.matchAll(markdown)) {
    const target = match[3].replace(/^<|>$/g, '');
    links.push({
      kind: match[1] ? 'image' : 'link',
      target,
      ...(match[1] ? { alt: match[2] } : {}),
      line: lineOf(body, match.index ?? 0),
    });
  }
  for (const match of body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    links.push({
      kind: 'image',
      target: /\bsrc="([^"]*)"/i.exec(tag)?.[1] ?? '',
      alt: /\balt="([^"]*)"/i.exec(tag)?.[1] ?? '',
      line: lineOf(body, match.index ?? 0),
    });
  }
  for (const match of body.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)) {
    links.push({ kind: 'link', target: match[1], line: lineOf(body, match.index ?? 0) });
  }
  // [text][ref] definitions: `[ref]: target`
  for (const match of body.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(\S+)/gm)) {
    links.push({ kind: 'link', target: match[1], line: lineOf(body, match.index ?? 0) });
  }
  return links;
}

/** GitHub's anchor for a heading text (github-slugger). */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** Every anchor a doc's headings get on GitHub, with `-1`, `-2` for repeats. */
export function anchorsIn(text: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const match of withoutFences(text).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    // Inline markup does not reach the anchor: `code`, **bold**, [links](…).
    const textOnly = match[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '');
    const base = slug(textOnly);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  // Explicit anchors: <a id="…"> / <a name="…">
  for (const match of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/gi)) anchors.add(match[1]);
  return anchors;
}

export { rel };
