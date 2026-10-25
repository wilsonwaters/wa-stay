/**
 * Settings → Accounts: a provider's notice (§12.37). Stay Rottnest's row says whether it is
 * accepted: "Notice not accepted" with "Read the notice", which opens it to accept, or "Notice
 * accepted on {date}" with Withdraw, asked first. ParkStay, with no notice, has no such group.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { ok } from '@tests/utils/renderer/createMockApi';
import { ROTTNEST_MANIFEST } from '@tests/utils/renderer/manifests';
import {
  NOT_CONNECTED,
  row,
  rows,
  setupAccounts,
} from '@tests/fixtures/renderer/settings-accounts';
import { PARKSTAY, politeAnnouncement } from '@tests/fixtures/renderer/settings';

const NOTICE = ROTTNEST_MANIFEST.notice!;
const NOT_ACCEPTED = { providerId: 'rottnest', required: true, accepted: false, version: 1 };
const ACCEPTED = { ...NOT_ACCEPTED, accepted: true, acceptedAt: '2026-10-18T02:00:00.000Z' };

function setup(initial = NOT_ACCEPTED) {
  let current: typeof NOT_ACCEPTED | typeof ACCEPTED = initial;
  const notice = jest.fn(async () => ok(current));
  const acceptNotice = jest.fn(async () => {
    current = ACCEPTED;
    return ok(current);
  });
  const withdrawNotice = jest.fn(async () => {
    current = NOT_ACCEPTED;
    return ok(current);
  });
  const rendered = setupAccounts({
    providers: [PARKSTAY, ROTTNEST_MANIFEST],
    accounts: [NOT_CONNECTED],
    notice,
    acceptNotice,
    withdrawNotice,
  });
  return { ...rendered, notice, acceptNotice, withdrawNotice };
}

const group = () =>
  within(row('Stay Rottnest')).getByRole('region', { name: 'Stay Rottnest notice' });

describe('Settings → Accounts: provider notices', () => {
  it('only Stay Rottnest has a Notice group, and only its notice is asked for', async () => {
    const { notice } = setup();
    await rows();
    expect(await within(group()).findByText('Notice not accepted')).toBeVisible();
    expect(within(group()).getByRole('heading', { level: 4, name: 'Notice' })).toBeVisible();
    expect(
      within(row('ParkStay WA')).queryByRole('heading', { name: 'Notice' })
    ).not.toBeInTheDocument();
    expect(notice.mock.calls).toEqual([['rottnest']]);
  });

  it('not accepted: "Read the notice" opens it, and accepting shows the date and is announced', async () => {
    const { user, acceptNotice } = setup();
    await rows();
    const read = await within(group()).findByRole('button', { name: 'Read the notice' });
    expect(read).toHaveAccessibleDescription('Notice not accepted');
    expect(group()).toHaveTextContent(
      "WA Stay checks nothing on Stay Rottnest until you've read and accepted it."
    );

    await user.click(read);
    const dialog = screen.getByRole('dialog', { name: NOTICE.title });
    await user.click(within(dialog).getByRole('checkbox', { name: NOTICE.confirmLabel }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

    expect(await within(group()).findByText('Notice accepted on 18 Oct 2026')).toBeVisible();
    expect(acceptNotice).toHaveBeenCalledWith('rottnest', 1);
    await waitFor(() =>
      expect(politeAnnouncement()).toBe('Notice accepted. WA Stay can check Stay Rottnest now.')
    );
  });

  it('accepted: Withdraw asks first, then withdraws, and Cancel changes nothing', async () => {
    const { user, withdrawNotice } = setup(ACCEPTED);
    await rows();
    const withdraw = await within(group()).findByRole('button', { name: 'Withdraw' });
    expect(withdraw).toHaveAccessibleDescription('Notice accepted on 18 Oct 2026');

    await user.click(withdraw);
    const confirm = screen.getByRole('alertdialog', {
      name: "Withdraw your acceptance of Stay Rottnest's notice?",
    });
    expect(confirm).toHaveTextContent(
      'WA Stay stops checking Stay Rottnest at once. Its watches pause until you accept the notice again.'
    );
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(withdrawNotice).not.toHaveBeenCalled();

    await user.click(within(group()).getByRole('button', { name: 'Withdraw' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Withdraw' })
    );
    expect(await within(group()).findByText('Notice not accepted')).toBeVisible();
    expect(withdrawNotice).toHaveBeenCalledWith('rottnest');
    await waitFor(() =>
      expect(politeAnnouncement()).toBe('Withdrawn. WA Stay no longer checks Stay Rottnest.')
    );
  });
});
