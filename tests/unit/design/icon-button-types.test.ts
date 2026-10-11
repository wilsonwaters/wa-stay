/**
 * @jest-environment node
 *
 * IconButton's `label` is required at the type level. The check itself is
 * `src/renderer/components/ui/IconButton.type-test.tsx`, run by `npm run type-check`; this only
 * makes sure that file stays in place and in the renderer type-check, so the check cannot
 * disappear quietly. It reads files and builds no TypeScript program (one in a Jest worker
 * crashed the macOS runner's Node more than once).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TYPE_TEST = 'src/renderer/components/ui/IconButton.type-test.tsx';

describe('IconButton types', () => {
  const source = fs.readFileSync(path.join(ROOT, TYPE_TEST), 'utf8');

  it('type-checks a button with a label', () => {
    expect(source).toMatch(/<IconButton label="[^"]+" icon=\{null\} \/>/);
  });

  it('expects a type error for a button without one', () => {
    expect(source).toMatch(
      /\/\/ @ts-expect-error[^\n]*\nexport const \w+ = <IconButton icon=\{null\} \/>;/
    );
  });

  it('is part of the renderer type-check', () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.renderer.json'), 'utf8'));
    expect(config.include).toContain('src/renderer/**/*');
    expect(
      config.exclude.some((pattern: string) => TYPE_TEST.endsWith(pattern.replace('**/*', '')))
    ).toBe(false);
  });
});
