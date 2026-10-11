/**
 * Whether the app runs from a source checkout: the only case in which development and test
 * hooks (the dev server's `ELECTRON_RENDERER_URL`, the `WA_STAY_*` test variables in
 * `testing/env.ts`) are honoured (architecture-notes §12.14).
 *
 * `app.isPackaged` alone is not enough. Electron derives it from the executable's name: any
 * name but `electron` (`electron.exe` on Windows) counts as packaged. So a packaged build whose
 * executable was renamed to `electron` reports `isPackaged === false`. Such a build still loads
 * its code from `resources/app.asar`, and a source checkout never does, so the app path
 * (`app.getAppPath()`) must also be outside any asar archive.
 */

/** Where the running app was loaded from, as Electron's `app` reports it. */
export interface AppSource {
  /** `app.isPackaged`: false when the executable is named `electron`. */
  readonly isPackaged: boolean;
  /** `app.getAppPath()`: the project root from source, `<resources>/app.asar` when packaged. */
  readonly appPath: string;
}

/** True when `file` is an asar archive or a path inside one (a segment ending in `.asar`). */
export function isInsideAsar(file: string): boolean {
  return file.split(/[\\/]+/).some((segment) => /\.asar$/i.test(segment));
}

/** Unpackaged, and not loaded from an asar archive (see the module comment). */
export function runsFromSource(source: AppSource): boolean {
  return !source.isPackaged && !isInsideAsar(source.appPath);
}
