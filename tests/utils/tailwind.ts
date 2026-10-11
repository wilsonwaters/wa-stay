/**
 * The renderer's real stylesheet, compiled as the build compiles it: src/renderer/styles/index.css
 * through PostCSS and Tailwind 4 (postcss.config.js), with the classes the renderer's sources
 * use. `classes` adds more, for a test that checks a class no source uses yet.
 */
// First: Tailwind must not register a module hook in Jest's sandbox (see the module).
import './no-module-hooks';
import fs from 'fs';
import path from 'path';
import postcss, { type Plugin } from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

export const ROOT = path.resolve(__dirname, '../..');
export const INDEX_CSS = path.join(ROOT, 'src/renderer/styles/index.css');

export interface CompileOptions {
  /** Extra class names, space-separated. */
  classes?: string;
  /** Unwraps every `@layer` block, for jsdom, whose CSS parser drops them. */
  unlayered?: boolean;
}

/** Replaces each `@layer name { … }` block with its rules, and drops `@layer a, b;` lists. */
const unwrapLayers: Plugin = {
  postcssPlugin: 'unwrap-layers',
  OnceExit(root) {
    root.walkAtRules('layer', (rule) => {
      if (rule.nodes) rule.replaceWith(rule.nodes);
      else rule.remove();
    });
  },
};

export async function compileStylesheet({
  classes,
  unlayered = false,
}: CompileOptions = {}): Promise<string> {
  const css = fs.readFileSync(INDEX_CSS, 'utf8');
  const input = classes ? `${css}\n@source inline(${JSON.stringify(classes)});\n` : css;
  const plugins: Plugin[] = [
    // Nesting is flattened (as in the build), so jsdom and simple string checks can read it.
    tailwindcss({ base: ROOT, optimize: { minify: false } }) as Plugin,
  ];
  if (unlayered) plugins.push(unwrapLayers);
  const result = await postcss(plugins).process(input, { from: INDEX_CSS });
  return result.css;
}
