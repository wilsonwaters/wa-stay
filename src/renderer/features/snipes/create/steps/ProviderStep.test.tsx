/**
 * The provider step (R13): a provider that places no holds says "Alerts only" under its name,
 * as part of its card's description; one with holds says nothing more.
 */
import { screen, within } from '@testing-library/react';
import { ALERT_ONLY_MANIFEST, snipeFlowApi as api } from '@tests/fixtures/renderer/snipes';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

describe('ProviderStep', () => {
  it('says "Alerts only" under a provider without holds', async () => {
    renderWithApp({
      route: '/site-sniper/new',
      api: api({}, [PARKSTAY_MANIFEST, ALERT_ONLY_MANIFEST, FAKE_MANIFEST]),
    });
    const group = await screen.findByRole('radiogroup', { name: 'Which provider' });
    const alertStay = within(group).getByRole('radio', { name: 'Alert Stay Parks' });
    // The full stop is for screen readers only (jsdom spaces it from the words)
    expect(alertStay).toHaveAccessibleDescription(
      /^Alerts only ?\. Holiday parks that take no holds$/
    );
    expect(within(group).getByText('Alerts only')).toBeVisible();

    const parkstay = within(group).getByRole('radio', { name: 'ParkStay WA' });
    expect(parkstay).toHaveAccessibleDescription(PARKSTAY_MANIFEST.description);
    expect(within(group).getAllByText('Alerts only')).toHaveLength(1);
    // A provider without Site Sniper is not listed at all
    expect(within(group).queryByRole('radio', { name: 'Fake Stay Holidays' })).toBeNull();
  });
});
