/**
 * `assertTypeEquals` pins zod schemas to their types in both directions (§12.30). The check
 * happens at compile time, so these tests run the TypeScript compiler on small probes: the
 * real schema assertions compile, and a type that gains a field the schema lacks does not.
 */

import path from 'path';
import ts from 'typescript';
import { assertTypeEquals } from '@shared/utils/type-equality';

const ROOT = path.resolve(__dirname, '../../..');
const PROBE = path.join(ROOT, 'tests/unit/shared/__type-equality-probe__.ts');

/** Type-checks `source` as if it were a file in this folder; returns the error messages. */
function compile(source: string): string[] {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  // TypeScript hands back forward-slash paths; on Windows PROBE has backslashes.
  const isProbe = (name: string) => path.normalize(name) === PROBE;
  host.getSourceFile = (name, version, ...rest) =>
    isProbe(name)
      ? ts.createSourceFile(name, source, version)
      : getSourceFile.call(host, name, version, ...rest);
  host.fileExists = (name) => isProbe(name) || fileExists.call(host, name);
  host.readFile = (name) => (isProbe(name) ? source : readFile.call(host, name));
  const program = ts.createProgram([PROBE], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

const IMPORTS = `
import { z } from 'zod';
import { assertTypeEquals } from '../../../src/shared/utils/type-equality';
import { StayQuerySchema, type StayQuery } from '../../../src/shared/types/provider.types';
`;

describe('assertTypeEquals', () => {
  it('does nothing at run time', () => {
    expect(assertTypeEquals<string, string>(true)).toBeUndefined();
  });

  it('compiles for a schema and the type it validates, both ways', () => {
    expect(
      compile(`${IMPORTS}
assertTypeEquals<z.input<typeof StayQuerySchema>, StayQuery>(true);
assertTypeEquals<z.output<typeof StayQuerySchema>, StayQuery>(true);
`)
    ).toEqual([]);
  }, 30_000);

  it('fails to compile when the type gains an optional field the schema lacks', () => {
    expect(
      compile(`${IMPORTS}
type Drifted = StayQuery & { pets?: number };
assertTypeEquals<z.output<typeof StayQuerySchema>, { [K in keyof Drifted]: Drifted[K] }>(true);
`)
    ).toEqual([`Argument of type 'true' is not assignable to parameter of type 'false'.`]);
  }, 30_000);

  it('fails to compile for a missing field or optional against required', () => {
    expect(
      compile(`${IMPORTS}
assertTypeEquals<{ a: string; b: string }, { a: string }>(true);
assertTypeEquals<{ a?: string }, { a: string }>(true);
`)
    ).toHaveLength(2);
  }, 30_000);
});
