/**
 * The composition root in fixture mode (test-only): every provider context gets a
 * `FixtureHttpClient` and no session partition. Without `fixtureMode` (always when
 * packaged) providers get their `ElectronSessionHttpClient` as before.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDatabase } from '@main/database/connection';
import { createContainer, type AppContainer } from '@main/app/container';
import { createProviderContext, type ProviderContext } from '@main/providers/sdk';
import { ElectronSessionHttpClient } from '@main/providers/sdk/http-electron';
import { FixtureHttpClient, readUnexpectedRequests } from '@main/testing';
import { TEST_LOGS_DIR } from '@tests/utils/ipc-harness';
import { containerSecrets } from '@tests/utils/fake-safe-storage';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('@main/providers/sdk', () => {
  const actual = jest.requireActual('@main/providers/sdk');
  return { ...actual, createProviderContext: jest.fn(actual.createProviderContext) };
});

const { session } = jest.requireMock('electron') as { session: { fromPartition: jest.Mock } };

let dir: string;
let container: AppContainer | undefined;

function parkstayContext(): ProviderContext {
  const result = jest
    .mocked(createProviderContext)
    .mock.results.find((r) => (r.value as ProviderContext).id === 'parkstay');
  return result?.value as ProviderContext;
}

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-container-fixtures-'));
});

afterEach(() => {
  container?.dispose();
  container = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

it('fixture mode: each provider is served by a FixtureHttpClient on the fixtures folder, with no partition', async () => {
  const fixturesDir = path.join(dir, 'fixtures');
  fs.mkdirSync(path.join(fixturesDir, 'parkstay'), { recursive: true });
  fs.writeFileSync(
    path.join(fixturesDir, 'parkstay', 'manifest.json'),
    JSON.stringify({ routes: [{ method: 'GET', path: '/api/ping/', file: 'ping.json' }] })
  );
  fs.writeFileSync(path.join(fixturesDir, 'parkstay', 'ping.json'), '{"pong":true}');
  const logFile = path.join(dir, 'e2e-unexpected-requests.log');

  container = createContainer({
    db: openDatabase(':memory:'),
    logsDir: TEST_LOGS_DIR,
    ...containerSecrets(),
    fixtureMode: { fixturesDir, logFile },
  });

  const http = parkstayContext().http;
  expect(http).toBeInstanceOf(FixtureHttpClient);
  expect(session.fromPartition).not.toHaveBeenCalled();
  await expect(http.getJson('https://parkstay.dbca.wa.gov.au/api/ping/')).resolves.toEqual({
    pong: true,
  });
  await expect(http.getJson('https://parkstay.dbca.wa.gov.au/api/other/')).rejects.toThrow(
    'no fixture for GET'
  );
  expect(readUnexpectedRequests(logFile)).toHaveLength(1);
});

it('without fixture mode each provider keeps its session-partition client', () => {
  container = createContainer({
    db: openDatabase(':memory:'),
    logsDir: TEST_LOGS_DIR,
    ...containerSecrets(),
  });

  expect(parkstayContext().http).toBeInstanceOf(ElectronSessionHttpClient);
  expect(session.fromPartition).toHaveBeenCalledWith('persist:provider-parkstay');
});

const MAP_REQUEST = {
  key: 'parkstay:20#campground-map',
  providerId: 'parkstay',
  providerName: 'ParkStay',
  url: 'https://parkstay.dbca.wa.gov.au/media/parkstay/campground_maps/20/map.pdf',
  title: 'Bungarra · Campground map',
  documentName: 'campground map',
  mediaType: 'application/pdf',
};

it('fixture mode: a document window’s partition answers from the fixtures', () => {
  const logFile = path.join(dir, 'e2e-unexpected-requests.log');
  container = createContainer({
    db: openDatabase(':memory:'),
    logsDir: TEST_LOGS_DIR,
    ...containerSecrets(),
    fixtureMode: { fixturesDir: path.join(dir, 'fixtures'), logFile },
  });

  void container.documentWindows.open(MAP_REQUEST);

  const documents = session.fromPartition.mock.results.find(
    (_r, i) => session.fromPartition.mock.calls[i][0] === 'documents-parkstay'
  )?.value as { protocol: { handle: jest.Mock }; webRequest: { onBeforeRequest: jest.Mock } };
  expect(documents.protocol.handle.mock.calls.map((c) => c[0])).toEqual(['https', 'http']);
  expect(documents.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
});

it('without fixture mode a document window’s partition is left to the network', () => {
  container = createContainer({
    db: openDatabase(':memory:'),
    logsDir: TEST_LOGS_DIR,
    ...containerSecrets(),
  });

  void container.documentWindows.open({ ...MAP_REQUEST, providerId: 'nofixtures' });

  const index = session.fromPartition.mock.calls.findIndex((c) => c[0] === 'documents-nofixtures');
  const documents = session.fromPartition.mock.results[index].value as {
    protocol: { handle: jest.Mock };
    webRequest: { onBeforeRequest: jest.Mock };
  };
  expect(documents.protocol.handle).not.toHaveBeenCalled();
  expect(documents.webRequest.onBeforeRequest).not.toHaveBeenCalled();
});
