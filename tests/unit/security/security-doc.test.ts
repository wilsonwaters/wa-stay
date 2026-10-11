/**
 * @jest-environment node
 *
 * docs/security.md has the "Secret storage" section: the backends, the Linux fallback and
 * its weakness, the legacy migration, and what "unreadable" means for users.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const doc = fs.readFileSync(path.join(ROOT, 'docs/security.md'), 'utf8');

/** The text of the `## Secret storage` section, up to the next `## ` heading. */
function secretStorageSection(): string {
  const start = doc.indexOf('\n## Secret storage\n');
  if (start === -1) return '';
  const next = doc.indexOf('\n## ', start + 1);
  return next === -1 ? doc.slice(start) : doc.slice(start, next);
}

describe('docs/security.md', () => {
  const section = secretStorageSection();

  it('has a "Secret storage" section', () => {
    expect(section).not.toBe('');
  });

  it.each([
    ['the envelope format', 'vault:v1:<backend>:<base64>'],
    ['the backends', '### Backends'],
    ['the os backend', '`os`'],
    ['the local key file', 'secret-vault.key'],
    ['the Linux fallback and its weakness', '### The Linux fallback and its weakness'],
    ['basic_text', 'basic_text'],
    ['the legacy migration', '### Legacy (v1.x) secrets'],
    ['what unreadable means', '### What "unreadable" means'],
    ['the startup order', '§12.23'],
  ])('covers %s', (_topic, text) => {
    expect(section).toContain(text);
  });
});
