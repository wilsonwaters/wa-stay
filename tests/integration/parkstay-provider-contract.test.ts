/**
 * V1's provider conformance suite against the real ParkStay module, on `NodeHttpClient`,
 * talking to a local server that serves the trimmed live samples.
 */

import { describeProviderContract } from '@tests/utils/provider-contract';
import {
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';
import { BUNGARRA_STAY, createTestParkStay } from '@tests/utils/parkstay-provider';

let server: ParkStayFixtureServer;

describeProviderContract('parkstay', async () => {
  server = await startParkStayFixtureServer();
  const { provider } = createTestParkStay(server, {
    // A short keep-alive, so the suite's holdOpen() check cannot leave a long timer behind.
    accessTimings: { keepAliveMs: 50 },
  });
  return {
    provider,
    sample: { externalId: '20', stay: BUNGARRA_STAY },
    unknownExternalId: 'does-not-exist-0',
    cleanup: async () => {
      provider.access.dispose();
      await server.close();
    },
  };
});
