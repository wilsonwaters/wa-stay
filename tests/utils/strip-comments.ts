/**
 * Source scanning helpers shared by the renderer guard tests (token guard, API boundary).
 */

/**
 * Blanks out comments while keeping line numbers, so commented-out classes are ignored.
 * String-aware: `//` or `/*` inside a quoted string or template literal is not a comment.
 * A `//` straight after `:` (a URL in JSX text) or `\` (an escaped slash in a regex) is not
 * treated as a comment either.
 * Quoted strings end at a newline, so an apostrophe in JSX text ("Don't") cannot swallow
 * more than the rest of its line; the guard then errs towards scanning, never towards hiding.
 */
export function stripComments(source: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  let out = '';
  let mode: 'code' | 'single' | 'double' | 'template' = 'code';
  // Brace depth inside code, and the depth each open `${` of a template literal started at.
  let depth = 0;
  const templateExprs: number[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === 'code') {
      const prev = source[i - 1];
      if (c === '/' && next === '/' && prev !== ':' && prev !== '\\') {
        const end = source.indexOf('\n', i);
        const stop = end === -1 ? source.length : end;
        out += blank(source.slice(i, stop));
        i = stop;
        continue;
      }
      if (c === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2);
        const stop = end === -1 ? source.length : end + 2;
        out += blank(source.slice(i, stop));
        i = stop;
        continue;
      }
      if (c === "'") mode = 'single';
      else if (c === '"') mode = 'double';
      else if (c === '`') mode = 'template';
      else if (c === '{') depth++;
      else if (c === '}') {
        if (templateExprs.length && templateExprs[templateExprs.length - 1] === depth) {
          templateExprs.pop();
          mode = 'template';
        } else depth--;
      }
      out += c;
      i++;
      continue;
    }
    if (c === '\\' && next !== '\n' && next !== undefined) {
      out += c + next;
      i += 2;
      continue;
    }
    if (mode === 'template') {
      if (c === '`') mode = 'code';
      else if (c === '$' && next === '{') {
        templateExprs.push(depth);
        mode = 'code';
        out += '${';
        i += 2;
        continue;
      }
    } else if (c === '\n' || c === (mode === 'single' ? "'" : '"')) {
      mode = 'code';
    }
    out += c;
    i++;
  }
  return out;
}
