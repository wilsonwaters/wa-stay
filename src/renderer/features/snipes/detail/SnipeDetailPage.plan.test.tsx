/**
 * An Open Day plan's page (§12.39): "Reminders set" while it runs, its next reminder, each
 * reminder at its time (those done marked), what to have ready, "Open Stay Rottnest", that it
 * only reminds (no
 * attempts, timing or Run now); once it has reminded, "Reminders sent" with "Watch for
 * cancellations" (the watch flow prefilled with its stay) and no Arm again; an expired plan
 * can't be armed again either.
 */
import { screen, within } from '@testing-library/react';
import { SnipeStatus } from '../../../../shared/types/common.types';
import { makePlan } from '@tests/fixtures/renderer/snipes';
import { catalogGet, makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { ok } from '@tests/utils/renderer/createMockApi';
import { ROTTNEST_MANIFEST } from '@tests/utils/renderer/manifests';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

const PLACE = makeLocationDetail({
  key: 'rottnest:geordie-bay',
  providerId: 'rottnest',
  externalId: 'geordie-bay',
  name: 'Geordie Bay',
  units: [],
});
/** Tue 3 Nov 2099, 6 pm Perth: the plan's first reminder. */
const FIRST = new Date('2099-11-03T10:00:00.000Z');

function open(plan: ReturnType<typeof makePlan>) {
  return renderWithApp({
    route: `/site-sniper/${plan.id}`,
    api: {
      providers: { list: jest.fn().mockResolvedValue(ok([ROTTNEST_MANIFEST])) },
      snipes: { get: jest.fn().mockResolvedValue(ok(plan)) },
      catalog: { get: catalogGet(PLACE) },
    },
  });
}

const heading = () => screen.findByRole('heading', { level: 1, name: 'Geordie Bay in July' });
const rows = () =>
  within(screen.getByRole('region', { name: 'Your reminders' }))
    .getAllByRole('listitem')
    .map((row) => row.firstChild?.textContent);

describe('SnipeDetailPage: an Open Day plan', () => {
  it('while it runs: "Reminders set", the next reminder, each one at its time and what to have ready', async () => {
    const { user } = open(makePlan({ remindersSent: [FIRST] }));
    await heading();
    expect(screen.getByText('Status').closest('p')).toHaveTextContent('Reminders set');
    expect(
      screen.getByText('Next reminder Wed 4 Nov, 6:00 am AWST: The waiting room is open')
    ).toBeInTheDocument();
    expect(rows()).toEqual([
      'Tue 3 Nov, 6:00 pm AWST · Open Day tomorrow Done',
      'Wed 4 Nov, 6:00 am AWST · The waiting room is open',
      'Wed 4 Nov, 8:15 am AWST · 15 minutes to Open Day',
    ]);
    expect(screen.getByRole('heading', { level: 2, name: 'Your reminders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Open Stay Rottnest/ })).toHaveAttribute(
      'href',
      'https://www.stayrottnest.com'
    );
    expect(
      within(screen.getByRole('region', { name: 'Have ready' })).getByText(
        "Your own mobile, for the waiting room's passcode. Temporary or virtual numbers aren't accepted."
      )
    ).toBeInTheDocument();

    // It only reminds: no attempts, timing or Run now
    const release = screen.getByRole('region', { name: 'Release' });
    expect(within(release).getByText('Reminds you before the release')).toBeInTheDocument();
    expect(within(release).queryByText('Checks')).toBeNull();
    expect(screen.queryByText('Attempts')).toBeNull();
    const progress = screen.getByRole('list', { name: 'Progress' });
    expect(within(progress).getByText('Reminders set').closest('li')).toHaveAttribute(
      'aria-current',
      'step'
    );
    expect(screen.getByRole('button', { name: 'Disarm' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^More actions for/ }));
    expect(screen.queryByRole('menuitem', { name: 'Run now' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('once reminded: "Reminders sent", a watch for cancellations prefilled, and no Arm again', async () => {
    open(
      makePlan({
        status: SnipeStatus.REMINDED,
        isActive: false,
        remindersSent: [
          FIRST,
          new Date('2099-11-03T22:00:00.000Z'),
          new Date('2099-11-04T00:15:00.000Z'),
        ],
      })
    );
    await heading();
    const notice = screen
      .getAllByRole('status')
      .find((el) => el.textContent?.startsWith('Reminders sent'));
    expect(notice).toHaveTextContent("The Open Day has come. Didn't get it?");
    expect(within(notice!).getByRole('link', { name: 'Watch for cancellations' })).toHaveAttribute(
      'href',
      '#/watches/new?provider=rottnest&location=geordie-bay&arrival=2099-07-06&departure=2099-07-08&adults=2'
    );
    expect(rows().every((row) => row?.endsWith('Done'))).toBe(true);
    expect(screen.queryByRole('button', { name: /^Arm/ })).toBeNull();
    expect(screen.queryByText(/^Next reminder/)).toBeNull();
  });

  it('an expired plan says why and is not offered Arm again', async () => {
    open(
      makePlan({
        status: SnipeStatus.EXPIRED,
        isActive: false,
        lastError: 'The release passed before the plan could remind you',
      })
    );
    await heading();
    expect(
      screen.getByText('The release passed before the plan could remind you')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Arm/ })).toBeNull();
  });
});
