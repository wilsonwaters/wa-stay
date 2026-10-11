/**
 * Diagnosis used by the native-ABI pretest guard (scripts/check-native-abi.js).
 */

import { diagnose } from '../../scripts/lib/native-abi';

const NODE_22 = { modules: '127', version: 'v22.22.0' };
const NODE_20 = { modules: '115', version: 'v20.11.1' };

/** Node's dlopen error for a module built for another ABI (the wording is not platform-specific). */
function abiMismatchError(modulePath: string, compiledAbi: number, runtimeAbi: number): Error {
  return Object.assign(
    new Error(
      `The module '${modulePath}'\n` +
        'was compiled against a different Node.js version using\n' +
        `NODE_MODULE_VERSION ${compiledAbi}. This version of Node.js requires\n` +
        `NODE_MODULE_VERSION ${runtimeAbi}. Please try re-compiling or re-installing\n` +
        'the module (for instance, using `npm rebuild` or `npm install`).'
    ),
    { code: 'ERR_DLOPEN_FAILED' }
  );
}

describe('native-abi diagnose', () => {
  it('explains a POSIX ABI mismatch with both ABI numbers and the fix', () => {
    const error = abiMismatchError(
      '/home/dev/wa-stay/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      119,
      127
    );

    const result = diagnose(error, NODE_22);

    expect(result.kind).toBe('abi-mismatch');
    expect(result.compiledAbi).toBe(119);
    expect(result.runtimeAbi).toBe(127);
    expect(result.message).toContain('NODE_MODULE_VERSION 119 (Electron 28)');
    expect(result.message).toContain('NODE_MODULE_VERSION 127');
    expect(result.message).toContain(NODE_22.version);
    expect(result.message).toContain("Electron's build");
    expect(result.message).toContain('npm rebuild better-sqlite3');
  });

  it('explains a Windows ABI mismatch without relying on POSIX paths', () => {
    const error = abiMismatchError(
      '\\\\?\\C:\\Users\\dev\\wa-stay\\node_modules\\better-sqlite3\\build\\Release\\better_sqlite3.node',
      119,
      115
    );

    const result = diagnose(error, NODE_20);

    expect(result.kind).toBe('abi-mismatch');
    expect(result.compiledAbi).toBe(119);
    expect(result.runtimeAbi).toBe(115);
    expect(result.message).toContain('NODE_MODULE_VERSION 119 (Electron 28)');
    expect(result.message).toContain('NODE_MODULE_VERSION 115');
    expect(result.message).toContain('npm rebuild better-sqlite3');
  });

  it.each([
    [
      'the package is missing',
      Object.assign(
        new Error(
          "Cannot find module 'better-sqlite3'\nRequire stack:\n- /home/dev/wa-stay/scripts/check-native-abi.js"
        ),
        { code: 'MODULE_NOT_FOUND' }
      ),
    ],
    [
      'the binary was never built (npm ci --ignore-scripts)',
      new Error(
        'Could not locate the bindings file. Tried:\n' +
          ' → /home/dev/wa-stay/node_modules/better-sqlite3/build/better_sqlite3.node\n' +
          ' → /home/dev/wa-stay/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
      ),
    ],
  ])('gives an install hint when %s', (_case, error) => {
    const result = diagnose(error, NODE_22);

    expect(result.kind).toBe('not-installed');
    expect(result.message).toContain(error.message.split('\n')[0]);
    expect(result.message).toContain('npm ci');
    expect(result.message).toContain('npm rebuild better-sqlite3');
  });

  it('prints any other dlopen error unchanged', () => {
    const error = Object.assign(
      new Error(
        "/lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found (required by " +
          '/home/dev/wa-stay/node_modules/better-sqlite3/build/Release/better_sqlite3.node)'
      ),
      { code: 'ERR_DLOPEN_FAILED' }
    );

    const result = diagnose(error, NODE_22);

    expect(result.kind).toBe('load-error');
    expect(result.message).toContain(String(error.stack));
    expect(result.message).not.toContain('NODE_MODULE_VERSION');
    expect(result.message).not.toContain('npm rebuild');
  });

  it('reports success when better-sqlite3 loaded', () => {
    expect(diagnose(null, NODE_22)).toEqual({ kind: 'ok', message: '' });
  });
});
