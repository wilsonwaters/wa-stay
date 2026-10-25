/**
 * An Open Day plan on its card (§12.39): "Reminders set", the countdown to its Open Day and its
 * next reminder, its step with no attempts (it never checks), and no Run now; once reminded,
 * "Reminders sent" with no Arm again.
 */
import { screen, within } from '@testing-library/react';
import { SnipeStatus } from '../../../../shared/types/common.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { makePlan } from '@tests/fixtures/renderer/snipes';
import { createMockApi } from '@tests/utils/renderer/createMockApi';
import { ROTTNEST_MANIFEST } from '@tests/utils/renderer/manifests';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { SnipeCard } from './SnipeCard';

function renderCard(snipe: SiteSnipe) {
  const view = renderWithProviders(
    <SnipeCard snipe={snipe} manifest={ROTTNEST_MANIFEST} today="2099-06-01" />,
    { api: createMockApi() }
  );
  return { ...view, card: screen.getByRole('article', { name: snipe.name }) };
}

describe('SnipeCard: an Open Day plan', () => {
  it('reads "Reminders set", counts down to its Open Day, says its next reminder and makes no attempts', async () => {
    const { card, user } = renderCard(makePlan());
    expect(within(card).getByText('Status:', { exact: false }).closest('p')).toHaveTextContent(
      'Status: Reminders set'
    );
    expect(within(card).getByRole('timer', { name: /^Opens in/ })).toBeInTheDocument();
    expect(
      within(card).getByText('Next reminder Tue 3 Nov, 6:00 pm AWST: Open Day tomorrow')
    ).toBeInTheDocument();
    expect(within(card).getByText('Step 1 of 2: Reminders set')).toBeInTheDocument();
    expect(within(card).queryByText(/attempts/)).toBeNull();
    await user.click(within(card).getByRole('button', { name: /^More actions for/ }));
    expect(screen.queryByRole('menuitem', { name: 'Run now' })).toBeNull();
  });

  it('once reminded: "Reminders sent", and no Arm again', () => {
    const { card } = renderCard(makePlan({ status: SnipeStatus.REMINDED, isActive: false }));
    expect(within(card).getByText('Status:', { exact: false }).closest('p')).toHaveTextContent(
      'Status: Reminders sent'
    );
    expect(within(card).getByText('Step 2 of 2: Reminders sent')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /^Arm/ })).toBeNull();
    expect(within(card).queryByText(/^Next reminder/)).toBeNull();
  });
});
