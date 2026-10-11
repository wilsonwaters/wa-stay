/**
 * @jest-environment node
 *
 * Jest resolves asset imports the way Vite does: a plain `.svg` import is a URL string,
 * a `?raw` import is the file's text, and bundled font packages are inert stylesheets.
 */
import fs from 'fs';
import path from 'path';
import dabUrl from '../../../src/renderer/assets/brush/dab.svg';
import dabRaw from '../../../src/renderer/assets/brush/dab.svg?raw';
import figtree from '@fontsource-variable/figtree';
import fraunces from '@fontsource-variable/fraunces/opsz.css';
import styleMock from '../../utils/style-mock';

const DAB = path.resolve(__dirname, '../../../src/renderer/assets/brush/dab.svg');

describe('asset imports under Jest', () => {
  it('gives a plain .svg import a URL-shaped string, not the markup', () => {
    expect(typeof dabUrl).toBe('string');
    expect(dabUrl).toMatch(/^\/\S+\.svg$/);
    expect(dabUrl).not.toContain('<svg');
  });

  it('gives a ?raw .svg import the real file contents', () => {
    expect(dabRaw).toBe(fs.readFileSync(DAB, 'utf8'));
    expect(dabRaw).toContain('<svg');
  });

  it('maps bare and path @fontsource-variable imports to the style mock', () => {
    expect(figtree).toBe(styleMock);
    expect(fraunces).toBe(styleMock);
  });
});
