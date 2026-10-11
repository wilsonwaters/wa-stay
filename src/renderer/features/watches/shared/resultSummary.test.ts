import { WatchResult } from '../../../../shared/types/common.types';
import type { WatchExecutionResult } from '../../../../shared/types/watch.types';
import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import { makeUnit, makeWatch } from '@tests/fixtures/renderer/watches';
import { resultSummary, runResultMessage } from './resultSummary';

const SITES = { one: 'site', many: 'sites' };
const NIGHTS = ['2099-12-11', '2099-12-12'];
const checked = { lastCheckedAt: new Date('2099-12-01T00:00:00Z') };

describe('resultSummary', () => {
  it('says when a watch has not been checked', () => {
    expect(resultSummary(makeWatch(), SITES)).toBe('Not checked yet');
  });

  it('counts fully available units', () => {
    const watch = makeWatch({
      ...checked,
      lastResult: WatchResult.FOUND,
      lastAvailability: [
        makeUnit('1', NIGHTS),
        makeUnit('2', NIGHTS),
        makeUnit('3', NIGHTS, ['available', 'booked']),
      ],
    });
    expect(resultSummary(watch, SITES)).toBe('2 sites available');
  });

  it('counts the nights with something free for a partial result', () => {
    const watch = makeWatch({
      ...checked,
      stay: { ...makeWatch().stay, departure: '2099-12-16' },
      lastResult: WatchResult.PARTIAL_FOUND,
      lastAvailability: [
        makeUnit('1', ['2099-12-11', '2099-12-12'], ['available', 'booked']),
        makeUnit('2', ['2099-12-11', '2099-12-12'], ['booked', 'available']),
      ],
    });
    expect(resultSummary(watch, SITES)).toBe('2 of 5 nights available');
  });

  it('has words for nothing, failure, a hold and a booking', () => {
    expect(resultSummary(makeWatch({ ...checked, lastResult: WatchResult.NOT_FOUND }), SITES)).toBe(
      'Nothing yet'
    );
    expect(resultSummary(makeWatch({ ...checked, lastResult: WatchResult.ERROR }), SITES)).toBe(
      'Last check failed'
    );
    expect(
      resultSummary(
        makeWatch({
          ...checked,
          lastResult: WatchResult.HELD,
          hold: { reference: 'PB1', expiresAt: new Date(), unitId: '12' },
        }),
        SITES
      )
    ).toBe('Site 12 held');
    expect(resultSummary(makeWatch({ ...checked, lastResult: WatchResult.BOOKED }), SITES)).toBe(
      'Booked'
    );
  });
});

describe('runResultMessage', () => {
  const watch = makeWatch();
  const base: WatchExecutionResult = {
    watchId: 1,
    success: true,
    found: false,
    matches: [],
    checkedAt: new Date(),
  };
  const match = (unitId: string, arrival: string, departure: string, partial = false) => ({
    unitId,
    unitName: `Site ${unitId}`,
    arrival,
    departure,
    partial,
    priceKnown: false,
  });

  it('says how many units are free at the place', () => {
    expect(
      runResultMessage(
        {
          ...base,
          found: true,
          matches: [
            match('1', '2099-12-11', '2099-12-13'),
            match('2', '2099-12-11', '2099-12-13'),
            match('3', '2099-12-11', '2099-12-13'),
          ],
        },
        watch,
        SITES,
        PARKSTAY_MANIFEST
      )
    ).toBe('3 sites available at Osprey Bay');
  });

  it('counts the nights partial runs cover', () => {
    expect(
      runResultMessage(
        { ...base, found: true, matches: [match('1', '2099-12-11', '2099-12-12', true)] },
        watch,
        SITES,
        PARKSTAY_MANIFEST
      )
    ).toBe('1 of 2 nights available at Osprey Bay');
  });

  it('says nothing is free yet, or why the check failed', () => {
    expect(runResultMessage(base, watch, SITES, PARKSTAY_MANIFEST)).toBe('Nothing available yet');
    expect(
      runResultMessage(
        { ...base, success: false, error: 'ParkStay did not answer' },
        watch,
        SITES,
        PARKSTAY_MANIFEST
      )
    ).toBe('ParkStay did not answer');
  });

  it('tells a hold with its pay-by time in the provider’s zone', () => {
    expect(
      runResultMessage(
        {
          ...base,
          found: true,
          hold: {
            reference: 'PB1',
            unitId: '12',
            paymentUrl: 'https://example.com/pay',
            expiresAt: '2099-12-01T07:42:00Z',
          },
        },
        watch,
        SITES,
        PARKSTAY_MANIFEST
      )
    ).toBe('Site 12 held at Osprey Bay. Pay before Tue 1 Dec, 3:42 pm AWST.');
  });
});
