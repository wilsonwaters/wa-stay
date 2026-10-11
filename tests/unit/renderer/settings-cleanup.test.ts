/**
 * Settings and accounts (U4), checked over the source: the dead controls, the legacy pages and
 * their misleading copy are gone, Gmail OTP has no UI (master plan OQ7: nothing in main reads
 * an OTP; the "Gmail" mail-server preset of the email notifier is not OTP and stays), and every
 * Settings file is small enough to read.
 */
import fs from 'fs';
import path from 'path';

const RENDERER = path.resolve(__dirname, '../../../src/renderer');
const SETTINGS = path.join(RENDERER, 'features/settings');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function matches(dir: string, pattern: RegExp): string[] {
  return sourceFiles(dir).flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => pattern.test(line))
      .map(({ line, index }) => `${path.relative(RENDERER, file)}:${index + 1}: ${line.trim()}`)
  );
}

describe('Settings cleanup (U4)', () => {
  it('has no Gmail OTP UI or calls in the renderer', () => {
    expect(
      matches(
        RENDERER,
        /gmail\.(authorize|checkAuthStatus|revokeAuth|setCredentials|getCredentials)|gmail otp|GmailSection|api\.gmail/i
      )
    ).toEqual([]);
    expect(fs.existsSync(path.join(RENDERER, 'api/gmail.ts'))).toBe(false);
  });

  it('has no minimise to tray, log level, clear all data or open folder control', () => {
    expect(
      matches(RENDERER, /minimi[sz]e to .*tray|log level|clear all data|open folder/i)
    ).toEqual([]);
  });

  it.each([
    'pages/Login.tsx',
    'pages/Settings.tsx',
    'components/settings',
    'features/settings/legacy',
  ])('%s is deleted', (file) => {
    expect(fs.existsSync(path.join(RENDERER, file))).toBe(false);
  });

  it('has no window.api.auth and none of the misleading privacy copy', () => {
    expect(
      matches(RENDERER, /window\.api\.auth|never sent to any|never leaves your device/)
    ).toEqual([]);
  });

  it('keeps every file in features/settings to 250 lines or fewer', () => {
    const long = sourceFiles(SETTINGS)
      .map((file) => ({
        file: path.relative(RENDERER, file),
        lines: fs.readFileSync(file, 'utf8').split(/\r?\n/).length,
      }))
      .filter(({ lines }) => lines > 250);
    expect(long).toEqual([]);
  });
});
