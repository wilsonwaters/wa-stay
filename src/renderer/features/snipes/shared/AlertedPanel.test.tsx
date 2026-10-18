/**
 * An alerted snipe on its page (R13): what was free and when, the stay and the alert's note,
 * "Book on {shortName}" (the provider's booking page, in the browser) and "Arm again", after
 * which focus moves to the snipe's status line.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { SnipeStatus } from '../../../../shared/types/common.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { makeAlertedSnipe, makeSnipe } from '@tests/fixtures/renderer/snipes';
import { catalogGet, makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { createMockApi, ok, PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { AlertedPanel } from './AlertedPanel';
import { useSnipeActions } from './useSnipeActions';

const NOW = new Date();
const BOOK = 'Book on ParkStay (opens in your browser)';

function Alerted({ snipe }: { snipe: SiteSnipe }) {
  const actions = useSnipeActions(snipe, PARKSTAY_MANIFEST);
  return (
    <AlertedPanel
      snipe={snipe}
      manifest={PARKSTAY_MANIFEST}
      actions={actions}
      today="2099-06-01"
      now={NOW}
    />
  );
}

const panel = (name: string) => screen.getByRole('region', { name });

describe('AlertedPanel', () => {
  it('names the unit that was free, when the alert came, the stay and its note', () => {
    const at = new Date(NOW.getTime() - 5 * 60_000);
    const snipe = makeAlertedSnipe({
      alert: {
        at,
        unitId: '3',
        unitName: 'CAMPSITE 03',
        note: 'Automatic holds are off for ParkStay, so Site Sniper alerted you instead.',
      },
    });
    renderWithProviders(<Alerted snipe={snipe} />);
    const region = panel('CAMPSITE 03 was free');
    expect(
      within(region).getByRole('heading', { level: 2, name: 'CAMPSITE 03 was free' })
    ).toBeInTheDocument();
    expect(
      within(region).getByText(/^Alert sent (?:\w{3} \d{1,2} \w{3}, )?\d{1,2}:\d{2} [ap]m AWST/)
    ).toBeInTheDocument();
    expect(
      within(region).getByText('For Fri 11 – Sun 13 Dec · 2 nights · 2 adults')
    ).toBeInTheDocument();
    expect(
      within(region).getByText(
        'Automatic holds are off for ParkStay, so Site Sniper alerted you instead.'
      )
    ).toBeInTheDocument();
    expect(
      within(region).getByText('Nothing is held, so book it on ParkStay before someone else does.')
    ).toBeInTheDocument();
  });

  it('"Book on ParkStay" is a link to the stored booking page, opening in the browser', () => {
    const snipe = makeAlertedSnipe();
    renderWithProviders(<Alerted snipe={snipe} />);
    const link = within(panel('CAMPSITE 03 was free')).getByRole('link', { name: BOOK });
    expect(link).toHaveAttribute('href', snipe.alert!.bookingUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('has no link when the alert has none, or one that is not https', () => {
    const { unmount } = renderWithProviders(
      <Alerted
        snipe={makeAlertedSnipe({ alert: { at: NOW, unitId: '3', unitName: 'CAMPSITE 03' } })}
      />
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Arm again' })).toBeInTheDocument();
    unmount();

    renderWithProviders(
      <Alerted
        snipe={makeAlertedSnipe({
          alert: { at: NOW, unitId: '3', bookingUrl: 'http://parkstay.dbca.wa.gov.au/' },
        })}
      />
    );
    expect(screen.queryByRole('link')).toBeNull();
    // No name in the alert: the unit by its id
    expect(screen.getByRole('heading', { name: 'Site 3 was free' })).toBeInTheDocument();
  });

  it('reads "Dates were free" for an alert that could not be read, with no unit, time or link', () => {
    renderWithProviders(<Alerted snipe={makeAlertedSnipe({ alert: undefined })} />);
    const region = panel('Dates were free');
    expect(within(region).queryByText(/^Alert sent/)).toBeNull();
    expect(within(region).queryByRole('link')).toBeNull();
    expect(within(region).getByRole('button', { name: 'Arm again' })).toBeInTheDocument();
  });

  it('"Arm again" arms the snipe through main', async () => {
    const activate = jest.fn().mockResolvedValue(ok(undefined));
    const snipe = makeAlertedSnipe();
    const { user } = renderWithProviders(<Alerted snipe={snipe} />, {
      api: { snipes: { activate } },
    });
    await user.click(screen.getByRole('button', { name: 'Arm again' }));
    expect(activate).toHaveBeenCalledWith(7);
    expect(await screen.findByText(`Armed ${snipe.name}`)).toBeInTheDocument();
  });
});

describe('SnipeDetailPage: an alerted snipe', () => {
  const detail = makeLocationDetail({
    units: [{ unitId: '3', unitName: 'CAMPSITE 03', unitType: 'Unpowered' }],
  });

  it('shows the alert panel, the status line and "When free", and no Arm again in the header', async () => {
    renderWithApp({
      route: '/site-sniper/7',
      api: {
        snipes: { get: jest.fn().mockResolvedValue(ok(makeAlertedSnipe())) },
        catalog: { get: catalogGet(detail) },
      },
    });
    const region = await screen.findByRole('region', { name: 'CAMPSITE 03 was free' });
    expect(within(region).getByRole('link', { name: BOOK })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Arm again' })).toHaveLength(1);
    expect(screen.getByText('Status').closest('p')).toHaveTextContent('StatusAlert sent');
    const release = screen.getByRole('region', { name: 'Release' });
    expect(within(release).getByText('When free').nextSibling).toHaveTextContent('Alert me');
    const progress = screen.getByRole('list', { name: 'Progress' });
    expect(within(progress).getByText('Alert sent').closest('li')).toHaveAttribute(
      'aria-current',
      'step'
    );
    // An alert needs no account: no Connect prompt
    expect(screen.queryByRole('button', { name: 'Connect ParkStay' })).toBeNull();
  });

  it('after "Arm again" focus moves to the status line, never to the page body', async () => {
    const alerted = makeAlertedSnipe();
    const armed = makeSnipe({ action: 'alert', status: SnipeStatus.ARMED });
    const get = jest.fn().mockResolvedValue(ok(alerted));
    const activate = jest.fn().mockImplementation(async () => {
      get.mockResolvedValue(ok(armed));
      mock.emit('snipe:updated', armed);
      return ok(undefined);
    });
    const mock = createMockApi({
      snipes: { get, activate },
      catalog: { get: catalogGet(detail) },
    });
    const { user } = renderWithApp({ route: '/site-sniper/7', api: mock });
    const region = await screen.findByRole('region', { name: 'CAMPSITE 03 was free' });
    await user.click(within(region).getByRole('button', { name: 'Arm again' }));

    expect(activate).toHaveBeenCalledWith(7);
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'CAMPSITE 03 was free' })).toBeNull()
    );
    const status = screen.getByText('Status').closest('p')!;
    await waitFor(() => expect(status).toHaveFocus());
    expect(status).toHaveTextContent('StatusArmed');
    expect(document.activeElement).not.toBe(document.body);
  });
});
