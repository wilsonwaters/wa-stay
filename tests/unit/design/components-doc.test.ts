/**
 * @jest-environment node
 *
 * docs/design/components.md covers every primitive the components/ui barrel exports: each
 * component and hook is named in the doc, and each component row has a Do and a Don't.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const doc = fs.readFileSync(path.join(ROOT, 'docs/design/components.md'), 'utf8');
const barrel = fs.readFileSync(path.join(ROOT, 'src/renderer/components/ui/index.ts'), 'utf8');

/** Runtime (non-type) names exported by the barrel. */
function exportedNames(): string[] {
  const names: string[] = [];
  for (const block of barrel.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const part of block[1].split(',')) {
      const name = part.trim();
      if (name && !name.startsWith('type ')) names.push(name);
    }
  }
  return names;
}

const COMPONENT = /^[A-Z][A-Za-z]+$/;
const HOOK = /^use[A-Z]/;
// Not primitives: context objects, the stack class, constants and pure helpers.
const NOT_PRIMITIVES = new Set([
  'ProviderManifestsContext',
  'OverlayStackContext',
  'KIND_ICONS',
  'DEFAULT_GUEST_HINTS',
  'DEFAULT_GUEST_LIMITS',
]);

describe('components.md', () => {
  const primitives = exportedNames().filter(
    (n) => (COMPONENT.test(n) || HOOK.test(n)) && !NOT_PRIMITIVES.has(n)
  );

  it('the barrel exports the primitives the spec requires', () => {
    for (const name of [
      'Button',
      'IconButton',
      'Field',
      'Combobox',
      'Menu',
      'Popover',
      'Switch',
      'Disclosure',
      'RadioCard',
      'Stepper',
      'DateRangeField',
      'GuestsField',
      'ProviderBadge',
      'ConfirmDialog',
      'useToast',
      'useAnnounce',
      'useFocusTrap',
      'usePosition',
      'useDisclosure',
    ]) {
      expect(primitives).toContain(name);
    }
  });

  it('names every exported component and hook', () => {
    const missing = primitives.filter((name) => !doc.includes(`\`${name}`));
    expect(missing).toEqual([]);
  });

  it('gives every component table row a use, a do and a don’t', () => {
    const rows = doc
      .split('\n')
      .filter((line) => /^\| `[A-Z]/.test(line))
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim())
      );
    expect(rows.length).toBeGreaterThan(25);
    for (const cells of rows) {
      expect(cells).toHaveLength(4);
      expect(cells.slice(1).every((cell) => cell.length > 10)).toBe(true);
    }
  });
});
