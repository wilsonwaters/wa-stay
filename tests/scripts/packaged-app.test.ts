/**
 * The package checks shared by `npm run smoke:packaged` and CI's Windows check
 * (scripts/lib/packaged-app.js): the expected fuses follow electron-builder.json, the asar
 * header is read and hashed as Electron does, and the integrity record is found in an exe.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  EXPECTED_FUSES,
  asarFiles,
  asarHeaderHash,
  betterSqlite3Contents,
  embeddedAsarIntegrity,
} from '../../scripts/lib/packaged-app';

const ROOT = path.resolve(__dirname, '..', '..');

/** A minimal asar archive: the size pickle, then the header pickle (no file data needed). */
function writeAsar(file: string, header: unknown): string {
  const json = JSON.stringify(header);
  const text = Buffer.from(json, 'utf8');
  const padded = Math.ceil(text.length / 4) * 4;
  const headerPickle = Buffer.alloc(8 + padded);
  headerPickle.writeUInt32LE(4 + padded, 0);
  headerPickle.writeUInt32LE(text.length, 4);
  text.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  fs.writeFileSync(file, Buffer.concat([sizePickle, headerPickle]));
  return json;
}

describe('EXPECTED_FUSES', () => {
  it('are the fuses electron-builder.json flips', () => {
    const builder = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8'));
    const configured = Object.fromEntries(
      Object.entries(builder.electronFuses as Record<string, boolean>).map(([key, on]) => [
        key.charAt(0).toUpperCase() + key.slice(1),
        on,
      ])
    );
    expect(EXPECTED_FUSES).toEqual(configured);
  });
});

describe('asar header', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-asar-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('lists the files, hashes the header text and reports better-sqlite3', () => {
    const integrity = { algorithm: 'SHA256', hash: 'ab', blockSize: 4, blocks: ['ab'] };
    const archive = path.join(dir, 'app.asar');
    const json = writeAsar(archive, {
      files: {
        'package.json': { size: 2, offset: '0', integrity },
        node_modules: {
          files: {
            'better-sqlite3': {
              files: {
                lib: { files: { 'index.js': { size: 1, offset: '2', integrity } } },
                prebuilds: { files: { 'linux-x64.node': { size: 9, unpacked: true } } },
              },
            },
          },
        },
      },
    });

    const entries = asarFiles(archive);
    expect(entries).toEqual([
      { path: 'package.json', unpacked: false, integrity },
      { path: 'node_modules/better-sqlite3/lib/index.js', unpacked: false, integrity },
      {
        path: 'node_modules/better-sqlite3/prebuilds/linux-x64.node',
        unpacked: true,
        integrity: undefined,
      },
    ]);
    expect(asarHeaderHash(archive)).toBe(crypto.createHash('sha256').update(json).digest('hex'));
    expect(betterSqlite3Contents(entries)).toEqual({
      prebuilds: ['prebuilds/linux-x64.node'],
      unpacked: ['prebuilds/linux-x64.node'],
      sources: [],
    });
  });
});

describe('embeddedAsarIntegrity', () => {
  it("finds electron-builder's record among an executable's bytes", () => {
    const hash = 'a'.repeat(64);
    const record = JSON.stringify([{ file: 'resources\\app.asar', alg: 'SHA256', value: hash }]);
    const exe = Buffer.concat([
      Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0xff, 0x22, 0x7b]),
      Buffer.from(record, 'utf8'),
      Buffer.from([0x00, 0x00, 0x7d]),
    ]);

    expect(embeddedAsarIntegrity(exe)).toEqual([
      { file: 'resources\\app.asar', alg: 'SHA256', value: hash },
    ]);
    expect(embeddedAsarIntegrity(Buffer.from('no record here'))).toEqual([]);
  });
});
