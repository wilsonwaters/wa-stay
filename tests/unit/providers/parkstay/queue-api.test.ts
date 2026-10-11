/**
 * The DBCA queue API call: its query and cross-site headers, and errors that never carry
 * the session key.
 */

import { ParkStayClient } from '@main/providers/parkstay/client';
import { generateSessionKey, QueueApi } from '@main/providers/parkstay/queue/queue-api';
import {
  CHROME_USER_AGENT,
  NodeHttpClient,
  ProviderHttpError,
  ProviderParseError,
} from '@main/providers/sdk';
import {
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';

const KEY = 'SECRETKEY000000000000000000000000000000000000000000';

describe('QueueApi', () => {
  let server: ParkStayFixtureServer;
  let api: QueueApi;

  beforeEach(async () => {
    server = await startParkStayFixtureServer();
    const client = new ParkStayClient(
      new NodeHttpClient({ providerId: 'parkstay' }),
      'parkstay',
      server.endpoints
    );
    api = new QueueApi(client, 'parkstay');
  });

  afterEach(async () => {
    await server.close();
  });

  it('asks check-create-session with the key and the parkstayv2 queue group, cross-site from ParkStay', async () => {
    await expect(api.checkCreateSession(KEY)).resolves.toMatchObject({ status: 'Active' });
    const [request] = server.requestsTo('/api/check-create-session/');
    expect(Object.fromEntries(request.query)).toEqual({
      session_key: KEY,
      queue_group: 'parkstayv2',
    });
    expect(request.headers).toMatchObject({
      'user-agent': CHROME_USER_AGENT,
      origin: 'https://parkstay.dbca.wa.gov.au',
      referer: 'https://parkstay.dbca.wa.gov.au/',
    });
  });

  it('rejects an HTTP error without the key in its message, URL or cause', async () => {
    server.queueAnswers = [{ status: 503, body: {} }];
    const error = await api.checkCreateSession(KEY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).status).toBe(503);
    expect((error as ProviderHttpError).url).not.toContain(KEY);
    expect((error as Error).cause).toBeUndefined();
    expect(JSON.stringify(error) + String((error as Error).message)).not.toContain(KEY);
  });

  it('rejects an answer that is not a queue session', async () => {
    server.queueAnswers = [{ status: 200, body: { hello: 'world' } }];
    await expect(api.checkCreateSession(KEY)).rejects.toBeInstanceOf(ProviderParseError);
  });
});

describe('generateSessionKey', () => {
  it('makes 52 characters of A-Z0-9, different each time', () => {
    const keys = Array.from({ length: 20 }, generateSessionKey);
    for (const key of keys) expect(key).toMatch(/^[A-Z0-9]{52}$/);
    expect(new Set(keys).size).toBe(20);
  });
});
