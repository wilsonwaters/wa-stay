/**
 * @jest-environment node
 *
 * D3 retired the login gate, the Dashboard and the sidebar layout, and moved every page under
 * features/. None of the old files may come back.
 */
import fs from 'fs';
import path from 'path';

const RENDERER = path.resolve(__dirname, '../../../src/renderer');

describe('renderer layout after the shell rebuild', () => {
  it.each([
    'pages',
    'App.tsx',
    'components/layouts/MainLayout.tsx',
    'components/ErrorBoundary.tsx',
    'pages/Login.tsx',
    'pages/Dashboard.tsx',
    // Rebuilt by U4 (features/settings/)
    'features/settings/legacy/Settings.tsx',
    'components/settings/EmailSettingsCard.tsx',
    'features/snipes/legacy',
    'components/forms/SiteSniperForm.tsx',
  ])('src/renderer/%s no longer exists', (file) => {
    expect(fs.existsSync(path.join(RENDERER, file))).toBe(false);
  });

  it('has no legacy page left under features/ (the provider-ux stream rebuilt them all)', () => {
    const features = path.join(RENDERER, 'features');
    const legacy = fs
      .readdirSync(features)
      .filter((domain) => fs.existsSync(path.join(features, domain, 'legacy')));
    expect(legacy).toEqual([]);
  });

  it('has main.tsx import nothing from the app but app/App', () => {
    const main = fs.readFileSync(path.join(RENDERER, 'main.tsx'), 'utf8');
    const imports = [...main.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['react', 'react-dom/client', './app/App']);
  });
});
