/**
 * The shared transport cases (`tests/utils/http-transport-cases.ts`) against NodeHttpClient.
 * `npm run test:electron` runs the same cases live against ElectronSessionHttpClient, so the
 * two clients keep the same redirect, cookie, URL, timeout and error semantics.
 */

import { CHROME_USER_AGENT, NodeHttpClient } from '@main/providers/sdk';
import {
  HTTP_TRANSPORT_CASES,
  startTransportTestServers,
  type TransportTestServers,
} from '@tests/utils/http-transport-cases';

let servers: TransportTestServers;

beforeAll(async () => {
  servers = await startTransportTestServers();
});

afterAll(async () => {
  await servers.close();
});

describe('HttpClient transport parity: NodeHttpClient', () => {
  it.each(HTTP_TRANSPORT_CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    await c.run({
      ...servers,
      client: new NodeHttpClient({ providerId: 'fake' }),
      userAgent: CHROME_USER_AGENT,
    });
  });
});
