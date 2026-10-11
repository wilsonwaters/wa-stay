/**
 * The app origin the IPC sender guard trusts: derived from the same entry the window loads.
 */

import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  createAppUrlMatcher,
  createFileUrlMatcher,
  resolveRendererEntry,
} from '@main/app/renderer-entry';

const BUILT = path.join(os.tmpdir(), 'built', 'index.html');
/** From a source checkout, installed, and installed with the executable renamed to electron. */
const SOURCE = { isPackaged: false, appPath: path.join(os.tmpdir(), 'wa-stay') };
const PACKAGED = { isPackaged: true, appPath: '/opt/WA Stay/resources/app.asar' };
const RENAMED = { isPackaged: false, appPath: '/opt/WA Stay/resources/app.asar' };

describe('resolveRendererEntry', () => {
  it('uses ELECTRON_RENDERER_URL when set (`npm start` sets it), on any port', () => {
    expect(
      resolveRendererEntry({ ELECTRON_RENDERER_URL: 'http://localhost:3005' }, BUILT, SOURCE)
    ).toEqual({ kind: 'dev-server', url: 'http://localhost:3005' });
  });

  it('falls back to http://localhost:3000 in development', () => {
    expect(resolveRendererEntry({ NODE_ENV: 'development' }, BUILT, SOURCE)).toEqual({
      kind: 'dev-server',
      url: 'http://localhost:3000',
    });
  });

  it('loads the built index.html otherwise', () => {
    expect(resolveRendererEntry({}, BUILT, SOURCE)).toEqual({ kind: 'file', path: BUILT });
  });

  it.each([
    ['a packaged build', PACKAGED],
    ['a packaged executable renamed to electron (isPackaged false, app.asar)', RENAMED],
  ])('%s ignores ELECTRON_RENDERER_URL and NODE_ENV and loads its own index.html', (_, source) => {
    expect(
      resolveRendererEntry(
        { ELECTRON_RENDERER_URL: 'https://evil.example', NODE_ENV: 'development' },
        BUILT,
        source
      )
    ).toEqual({ kind: 'file', path: BUILT });
  });
});

describe('createAppUrlMatcher', () => {
  it('dev: accepts any page on the dev server origin, nothing else', () => {
    const isAppUrl = createAppUrlMatcher({ kind: 'dev-server', url: 'http://localhost:3005' });

    expect(isAppUrl('http://localhost:3005/')).toBe(true);
    expect(isAppUrl('http://localhost:3005/#/watches/3')).toBe(true);
    expect(isAppUrl('http://localhost:3000/')).toBe(false);
    expect(isAppUrl('https://evil.example/')).toBe(false);
    expect(isAppUrl('not a url')).toBe(false);
  });

  it('prod: accepts the built index.html at a path with spaces and Unicode, with any hash', () => {
    const indexPath = path.join(os.tmpdir(), 'Program Files', 'WA Stay ☀ Café', 'index.html');
    const isAppUrl = createAppUrlMatcher({ kind: 'file', path: indexPath });
    const href = pathToFileURL(indexPath).href;

    expect(isAppUrl(href)).toBe(true);
    expect(isAppUrl(`${href}#/settings`)).toBe(true);
    // Chromium may leave some characters unencoded
    expect(isAppUrl(`file://${indexPath.split(path.sep).join('/')}`)).toBe(true);
    expect(isAppUrl(pathToFileURL(path.join(os.tmpdir(), 'other.html')).href)).toBe(false);
    expect(isAppUrl('https://evil.example/index.html')).toBe(false);
  });

  it('prod on Windows: the drive letter is compared case-insensitively, the rest exactly', () => {
    const isAppUrl = createFileUrlMatcher(
      'file:///C:/Program%20Files/WA%20Stay/resources/app.asar/dist/renderer/index.html'
    );

    expect(
      isAppUrl('file:///c:/Program%20Files/WA%20Stay/resources/app.asar/dist/renderer/index.html#/')
    ).toBe(true);
    expect(
      isAppUrl('file:///C:/Program Files/WA Stay/resources/app.asar/dist/renderer/index.html')
    ).toBe(true);
    expect(
      isAppUrl('file:///D:/Program%20Files/WA%20Stay/resources/app.asar/dist/renderer/index.html')
    ).toBe(false);
    expect(isAppUrl('file:///C:/Users/me/Downloads/index.html')).toBe(false);
  });
});
