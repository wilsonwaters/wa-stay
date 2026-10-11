/**
 * @jest-environment node
 *
 * The Tailwind theme (the `@theme` block in src/renderer/styles/index.css) exposes the semantic
 * token names, backed by tokens.css variables, and keeps the old `primary` scale only as a
 * commented legacy alias of ocean.
 */
import fs from 'fs';
import postcss, { type AtRule } from 'postcss';
import { compileStylesheet, INDEX_CSS } from '../../utils/tailwind';

/** The compiled stylesheet with `classes` added, whitespace collapsed. */
async function compile(classes: string): Promise<string> {
  return (await compileStylesheet({ classes })).replace(/\s+/g, ' ');
}

describe('tailwind theme', () => {
  it('carries the token values from tokens.css', async () => {
    const css = await compile('bg-accent');
    expect(css).toMatch(/:root \{ --ws-ink-900: 21 24 29;/);
    expect(css).toContain('--ws-accent: var(--ws-coral-600);');
  });

  it('imports tailwindcss and tokens.css before any other rule, as the build requires', () => {
    // Vite inlines @import rules first, and drops one that follows any other rule.
    const nodes = postcss
      .parse(fs.readFileSync(INDEX_CSS, 'utf8'))
      .nodes.filter((node) => node.type !== 'comment');
    const imports = nodes.map((node) => node.type === 'atrule' && node.name === 'import');
    expect(imports.slice(0, 2)).toEqual([true, true]);
    expect(imports.indexOf(true, 2)).toBe(-1);
    expect(nodes.slice(0, 2).map((node) => (node as AtRule).params)).toEqual([
      "'tailwindcss' source(none)",
      "'./tokens.css'",
    ]);
  });

  it('compiles semantic colour utilities onto RGB-triple variables', async () => {
    const css = await compile(
      'bg-accent text-accent-fg hover:bg-accent-hover text-fg-muted border-border-strong ring-focus bg-surface-subtle text-available-fg bg-sun-subtle'
    );
    expect(css).toContain('.bg-accent { background-color: rgb(var(--ws-accent)); }');
    expect(css).toContain('.text-accent-fg { color: rgb(var(--ws-accent-fg)); }');
    expect(css).toContain(
      '.hover\\:bg-accent-hover:hover { background-color: rgb(var(--ws-accent-hover)); }'
    );
    expect(css).toContain('color: rgb(var(--ws-fg-muted))');
    expect(css).toContain('.border-border-strong { border-color: rgb(var(--ws-border-strong)); }');
    expect(css).toContain('.ring-focus { --tw-ring-color: rgb(var(--ws-focus)); }');
    expect(css).toContain('background-color: rgb(var(--ws-surface-subtle))');
    expect(css).toContain('color: rgb(var(--ws-available-fg))');
    expect(css).toContain('background-color: rgb(var(--ws-sun-subtle))');
  });

  it('applies hover: on any pointer, as Tailwind 3 did, not only where hover is primary', async () => {
    const css = await compile('hover:bg-accent-hover');
    expect(css).not.toMatch(/@media \(hover: hover\)/);
  });

  it('makes a bare ring the opaque focus colour, with a surface-coloured offset', async () => {
    const css = await compile('ring-2 ring-offset-2');
    expect(css).toMatch(
      /\.ring-2 \{ --tw-ring-shadow: [^;]*var\(--tw-ring-color, rgb\(var\(--ws-focus\)\)\);/
    );
    expect(css).toMatch(
      /\.ring-offset-2 \{ --tw-ring-offset-width: 2px; --tw-ring-offset-shadow: [^;]*var\(--tw-ring-offset-color\);/
    );
    // The base layer sets the offset colour on every element, as Tailwind 3's defaults did.
    expect(css).toMatch(
      /::file-selector-button \{ border-color: rgb\(var\(--ws-border\)\); --tw-ring-offset-color: rgb\(var\(--ws-surface\)\); \}/
    );
    // Neither Tailwind's currentcolor ring nor a 3.x <alpha-value> placeholder.
    expect(css).not.toMatch(/--tw-ring-color, currentcolor|<alpha-value>/);
  });

  it('keeps explicit ring colours, such as ring-focus/40, working alongside the default', async () => {
    const css = await compile('ring-2 ring-focus/40');
    expect(css).toContain(
      '--tw-ring-color: color-mix(in oklab, rgb(var(--ws-focus)) 40%, transparent)'
    );
  });

  it('only darkens the legacy bridge buttons on hover while they are enabled', async () => {
    const css = await compile('btn-primary btn-secondary btn-danger');
    for (const btn of ['btn-primary', 'btn-secondary', 'btn-danger']) {
      expect(css).toMatch(new RegExp(`\\.${btn}:not\\(:disabled\\):hover\\s*\\{`));
      expect(css).not.toMatch(new RegExp(`\\.${btn}:hover\\s*\\{`));
    }
  });

  it('supports alpha modifiers such as bg-accent/10', async () => {
    const css = await compile('bg-accent/10');
    expect(css).toContain(
      'background-color: color-mix(in oklab, rgb(var(--ws-accent)) 10%, transparent)'
    );
  });

  it('maps type, radii, shadows, motion, layers and keyframes to tokens', async () => {
    const css = await compile(
      'font-sans font-display text-display-lg text-sm rounded-md rounded-lg shadow-card shadow-modal duration-fast ease-standard z-header z-tooltip animate-shimmer animate-fade-in animate-scale-in'
    );
    expect(css).toContain('font-family: var(--ws-font-sans)');
    expect(css).toContain('font-family: var(--ws-font-display)');
    // The build's optimiser writes -0.02em as -.02em.
    expect(css).toContain(
      'font-size: var(--ws-text-display-lg); line-height: var(--tw-leading, var(--ws-leading-display-lg)); letter-spacing: var(--tw-tracking, -.02em)'
    );
    expect(css).toContain(
      'font-size: var(--ws-text-sm); line-height: var(--tw-leading, var(--ws-leading-sm))'
    );
    expect(css).toContain('border-radius: var(--ws-radius-md)');
    expect(css).toContain('border-radius: var(--ws-radius-lg)');
    expect(css).toContain('--tw-shadow: var(--ws-shadow-card)');
    expect(css).toContain('--tw-shadow: var(--ws-shadow-modal)');
    expect(css).toContain('transition-duration: var(--ws-duration-fast)');
    expect(css).toContain('transition-timing-function: var(--ws-ease-standard)');
    expect(css).toContain('z-index: var(--ws-z-header)');
    expect(css).toContain('z-index: var(--ws-z-tooltip)');
    expect(css).toMatch(/@keyframes shimmer/);
    expect(css).toMatch(/@keyframes fade-in/);
    expect(css).toMatch(/@keyframes scale-in/);
    expect(css).toContain(
      'animation: fade-in var(--ws-duration-base) var(--ws-ease-standard) both'
    );
  });

  it('keeps Tailwind defaults for legacy pages', async () => {
    const css = await compile('bg-gray-50 text-red-600');
    expect(css).toContain('.bg-gray-50');
    expect(css).toContain('.text-red-600');
  });

  it('re-points legacy primary-* at ocean, and declares it only in the legacy block', async () => {
    const css = await compile('bg-primary-600 text-primary-700 focus:ring-primary-500');
    expect(css).toContain('background-color: rgb(var(--ws-ocean-600))');
    expect(css).toContain('color: rgb(var(--ws-ocean-700))');
    expect(css).toContain('--tw-ring-color: rgb(var(--ws-ocean-500))');

    const source = fs.readFileSync(INDEX_CSS, 'utf8');
    const start = source.indexOf('/* legacy: delete when U-stream lands.\n   * The old sky-blue');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('/* end legacy */', start);
    expect(end).toBeGreaterThan(start);
    const outside = source.slice(0, start) + source.slice(end);
    expect(outside).not.toMatch(/--color-primary|primary-\d/);
    expect(source.slice(start, end)).toMatch(/--color-primary-50:/);
    expect(source).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
