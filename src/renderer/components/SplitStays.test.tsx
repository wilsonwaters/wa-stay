/**
 * Split stays (§12.36): a stay free every night only by moving between units, shown for what it
 * is under a place's night grid and on a watch, never as "available". Booked through the place
 * ("Contact {place}", with "Copy {label}" beside it while a copyable detail is saved) or part
 * by part ("Book 6–7 Nov on ParkStay"). Roles and names only.
 */
import { act, screen, within } from '@testing-library/react';
import type { ProviderAccount, SplitStay } from '../../shared/types/provider.types';
import { RAC_SAVED, racAccount } from '@tests/fixtures/renderer/settings';
import { createMockApi, ok } from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import {
  SplitStays,
  splitStayResultLine,
  splitStaysNoun,
  splitStaysTitle,
  type SplitStaysProps,
} from './SplitStays';

const SITES = { one: 'site', many: 'sites' };
const SPOTS = { one: 'spot', many: 'spots' };
const CONTACT_URL = 'https://parksandresorts.rac.com.au/busselton/contact-us/';
const BOOK = 'https://parkstay.dbca.wa.gov.au/search-availability/campground/?site_id=20';

/** RAC's Powered Site: a free site every night of 1–6 Jul, but no one site for them all. */
const POWERED: SplitStay = {
  unitKind: 'campsite',
  booking: 'contact',
  unitId: 'cat:4',
  unitName: 'Powered Site',
  total: 450,
  contactUrl: CONTACT_URL,
};

/** ParkStay's sites at Osprey Bay: CAMPSITE 03 on the 6th, CAMPSITE 04 on the 7th. */
const DERIVED: SplitStay = {
  unitKind: 'campsite',
  booking: 'separate',
  units: 2,
  total: 55,
  parts: [
    {
      unitId: '3',
      unitName: 'CAMPSITE 03',
      arrival: '2099-11-06',
      departure: '2099-11-07',
      total: 25,
      bookingUrl: `${BOOK}&arrival=2099/11/06&departure=2099/11/07`,
    },
    {
      unitId: '4',
      unitName: 'CAMPSITE 04',
      arrival: '2099-11-07',
      departure: '2099-11-08',
      total: 30,
      bookingUrl: `${BOOK}&arrival=2099/11/07&departure=2099/11/08`,
    },
  ],
};

function apiWith(accounts: ProviderAccount[] = []) {
  return createMockApi({ accounts: { list: jest.fn().mockResolvedValue(ok(accounts)) } });
}

function renderBlock(props: Partial<SplitStaysProps> = {}, accounts: ProviderAccount[] = []) {
  return renderWithProviders(
    <SplitStays
      splitStays={[POWERED]}
      place="RAC Busselton Holiday Park"
      providerId="rac"
      shortName="RAC"
      arrival="2027-07-01"
      departure="2027-07-06"
      noun={SPOTS}
      currency="AUD"
      {...props}
    />,
    { api: apiWith(accounts) }
  );
}

const block = () => screen.getByRole('region', { name: /^Free if you move/ });
/** Lets the accounts query settle. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

describe('SplitStays: booked through the place (contact)', () => {
  it('is a section named by its h3, says what it means, and links the place’s contact page', () => {
    renderBlock();
    const region = block();
    expect(
      within(region).getByRole('heading', { level: 3, name: 'Free if you move sites' })
    ).toBeInTheDocument();
    expect(
      within(region).getByText(
        'No site is free for all 5 nights, but every night is free if you move between sites. It takes more than one booking.'
      )
    ).toBeInTheDocument();
    expect(
      within(region).getByRole('heading', { level: 4, name: 'Powered Site' })
    ).toBeInTheDocument();
    expect(within(region).getByText('About $450 for the 5 nights')).toBeInTheDocument();
    expect(
      within(region).getByText(
        'RAC Busselton Holiday Park can book this for you as separate stays.'
      )
    ).toBeInTheDocument();
    const contact = within(region).getByRole('link', {
      name: 'Contact RAC Busselton Holiday Park (opens in your browser)',
    });
    expect(contact).toHaveAttribute('href', CONTACT_URL);
    expect(contact).toHaveAttribute('target', '_blank');
    expect(contact).toHaveAttribute('rel', 'noopener noreferrer');
    // Never "available", and no count RAC can't give
    expect(region).not.toHaveTextContent(/available/i);
    expect(within(region).queryByText(/^Across/)).toBeNull();
  });

  it('names the place without a link when it has no contact page', () => {
    renderBlock({ splitStays: [{ ...POWERED, contactUrl: undefined }] });
    expect(screen.queryByRole('link')).toBeNull();
    expect(
      within(block()).getByText(
        'RAC Busselton Holiday Park can book this for you as separate stays. Contact RAC Busselton Holiday Park to book it.'
      )
    ).toBeInTheDocument();
  });

  it('shows no price when a night has none, and the count when the provider gives one', () => {
    renderBlock({ splitStays: [{ ...POWERED, total: undefined, units: 3 }] });
    expect(within(block()).queryByText(/^About/)).toBeNull();
    expect(within(block()).getByText('Across 3 sites')).toBeInTheDocument();
  });

  it('gives several split stays at one place one "Contact {place}", so no two links share a name', () => {
    renderBlock({
      splitStays: [POWERED, { ...POWERED, unitId: 'cat:5', unitName: 'Ensuite Site', total: 600 }],
    });
    const region = block();
    expect(
      within(region)
        .getAllByRole('heading', { level: 4 })
        .map((heading) => heading.textContent)
    ).toEqual(['Powered Site', 'Ensuite Site']);
    expect(within(region).getByText('About $600 for the 5 nights')).toBeInTheDocument();
    expect(within(region).getAllByRole('link')).toHaveLength(1);
    expect(
      within(region).getByText(
        'RAC Busselton Holiday Park can book any of these for you as separate stays.'
      )
    ).toBeInTheDocument();
  });

  it('puts "Copy RAC member number" beside "Contact {place}" only while one is saved', async () => {
    const { unmount } = renderBlock({}, [RAC_SAVED]);
    expect(
      await within(block()).findByRole('button', { name: 'Copy RAC member number' })
    ).toBeInTheDocument();
    unmount();

    renderBlock({}, [racAccount()]);
    await settle();
    expect(screen.queryByRole('button', { name: /^Copy/ })).toBeNull();
  });

  it('leaves "Copy {label}" to the view when it already has one (showCopy false)', async () => {
    renderBlock({ showCopy: false }, [RAC_SAVED]);
    await settle();
    expect(within(block()).getByRole('link', { name: /^Contact/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Copy/ })).toBeNull();
  });
});

describe('SplitStays: booked part by part (separate)', () => {
  const renderParts = (splitStays: SplitStay[] = [DERIVED]) =>
    renderBlock({
      splitStays,
      place: 'Osprey Bay',
      providerId: 'parkstay',
      shortName: 'ParkStay',
      arrival: '2099-11-06',
      departure: '2099-11-08',
      noun: SITES,
    });

  it('lists the parts in order, each with its own booking link, and how many bookings it takes', () => {
    renderParts();
    const region = block();
    expect(
      within(region).getByRole('heading', { level: 4, name: 'Across 2 sites' })
    ).toBeInTheDocument();
    expect(within(region).getByText('About $55 for the 2 nights')).toBeInTheDocument();
    const parts = within(region).getByRole('list');
    expect(parts.tagName).toBe('OL');
    const items = within(parts).getAllByRole('listitem');
    expect(items.map((item) => within(item).getByText(/ · /).textContent)).toEqual([
      'CAMPSITE 03 · 6–7 Nov · 1 night · $25',
      'CAMPSITE 04 · 7–8 Nov · 1 night · $30',
    ]);
    expect(within(parts).getAllByRole('link')).toHaveLength(2);
    expect(
      within(items[0]).getByRole('link', {
        name: 'Book 6–7 Nov on ParkStay (opens in your browser)',
      })
    ).toHaveAttribute('href', DERIVED.parts?.[0].bookingUrl);
    expect(
      within(items[1]).getByRole('link', {
        name: 'Book 7–8 Nov on ParkStay (opens in your browser)',
      })
    ).toHaveAttribute('href', DERIVED.parts?.[1].bookingUrl);
    expect(
      within(region).getByText('Book each part on ParkStay: 2 bookings in all.')
    ).toBeInTheDocument();
    // Nothing to contact, nothing to copy, never "available"
    expect(within(region).queryByRole('link', { name: /^Contact/ })).toBeNull();
    expect(region).not.toHaveTextContent(/available/i);
  });

  it('keeps a part without a link (refused, or the provider is gone), and a part without a price', () => {
    renderParts([
      {
        ...DERIVED,
        total: undefined,
        parts: DERIVED.parts?.map((part, i) =>
          i === 0 ? { ...part, bookingUrl: undefined, total: undefined } : part
        ),
      },
    ]);
    const items = within(within(block()).getByRole('list')).getAllByRole('listitem');
    expect(within(items[0]).queryByRole('link')).toBeNull();
    expect(within(items[0]).getByText('CAMPSITE 03 · 6–7 Nov · 1 night')).toBeInTheDocument();
    expect(within(items[1]).getByRole('link')).toBeInTheDocument();
    expect(within(block()).queryByText(/^About/)).toBeNull();
  });

  it('gives every link a name of its own when two split stays share a part’s dates', () => {
    // Two classes of one campground, each free night by night on a different site
    const classOf = (unitId: string, unitName: string): SplitStay => ({
      unitKind: 'campsite',
      booking: 'separate',
      unitId,
      unitName,
      parts: ['2099-11-06', '2099-11-07'].map((arrival, i) => ({
        unitId,
        unitName,
        arrival,
        departure: i === 0 ? '2099-11-07' : '2099-11-08',
        bookingUrl: `${BOOK}&class=${unitId}&n=${i}`,
      })),
    });
    renderParts([classOf('class:117', 'Campsite'), classOf('class:118', 'Powered campsite')]);
    const region = block();
    expect(within(region).getAllByRole('link')).toHaveLength(4);
    for (const name of [
      'Book 6–7 Nov on ParkStay for Campsite (opens in your browser)',
      'Book 7–8 Nov on ParkStay for Campsite (opens in your browser)',
      'Book 6–7 Nov on ParkStay for Powered campsite (opens in your browser)',
      'Book 7–8 Nov on ParkStay for Powered campsite (opens in your browser)',
    ]) {
      expect(within(region).getByRole('link', { name })).toBeInTheDocument();
    }
    // The visible words stay the spec's: the unit is for screen readers only
    expect(
      within(block())
        .getAllByRole('heading', { level: 4 })
        .map((h) => h.textContent)
    ).toEqual(['Campsite', 'Powered campsite']);
  });

  it('names cabins as cabins, from the split stay’s own kind', () => {
    renderParts([
      {
        ...DERIVED,
        unitKind: 'cabin',
        parts: DERIVED.parts?.map((part) => ({ ...part, unitName: `Cabin ${part.unitId}` })),
      },
    ]);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Free if you move cabins' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Across 2 cabins' })).toBeInTheDocument();
  });
});

describe('SplitStays: nothing to show', () => {
  it('renders nothing without a split stay', async () => {
    renderBlock({ splitStays: [] });
    await settle();
    expect(screen.queryByRole('region', { name: /^Free if you move/ })).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('split stay words', () => {
  it('names the units by the split stays’ kinds, else by the page’s noun', () => {
    expect(splitStaysNoun([POWERED], SPOTS)).toEqual(SITES);
    expect(splitStaysNoun([{ ...POWERED, unitKind: undefined }], SITES)).toEqual(SITES);
    expect(splitStaysNoun([POWERED, { ...POWERED, unitKind: 'cabin' }], SITES)).toEqual(SPOTS);
    expect(splitStaysTitle([POWERED], SPOTS)).toBe('Free if you move sites');
  });

  it('says the best one’s count on a watch’s card: "Free across 2 sites", else "Free if you move"', () => {
    expect(splitStayResultLine([DERIVED, POWERED], SPOTS)).toBe('Free across 2 sites');
    expect(splitStayResultLine([POWERED], SPOTS)).toBe('Free if you move sites');
    expect(splitStayResultLine([{ ...POWERED, unitKind: undefined }], SPOTS)).toBe(
      'Free if you move spots'
    );
    expect(splitStayResultLine(undefined, SITES)).toBe('Free if you move sites');
    expect(splitStayResultLine([{ ...DERIVED, units: 1 }], SITES)).toBe('Free if you move sites');
  });
});
