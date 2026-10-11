/**
 * Location keys: `${providerId}:${externalId}`, split on the first `:`.
 */

import {
  isLocationKey,
  LocationKeySchema,
  makeLocationKey,
  parseLocationKey,
} from '@shared/utils/location-key';

describe('location keys', () => {
  it('makes provider:externalId', () => {
    expect(makeLocationKey('parkstay', '123')).toBe('parkstay:123');
  });

  it('splits on the first ":" so an external id may contain more', () => {
    expect(parseLocationKey('parkstay:12:3')).toEqual({
      providerId: 'parkstay',
      externalId: '12:3',
    });
  });

  it.each([
    ['parkstay', '123'],
    ['parkstay', '12:3'],
    ['rac', 'park:site:7'],
    ['big-4', 'a b/c?d'],
  ])('round-trips %s / %s', (providerId, externalId) => {
    const key = makeLocationKey(providerId, externalId);
    expect(parseLocationKey(key)).toEqual({ providerId, externalId });
    expect(isLocationKey(key)).toBe(true);
  });

  it.each(['nokey', ':123', 'parkstay:', '', 'ParkStay:1', 'p:1'])('rejects "%s"', (key) => {
    expect(() => parseLocationKey(key)).toThrow(/Invalid location key/);
    expect(isLocationKey(key)).toBe(false);
    expect(LocationKeySchema.safeParse(key).success).toBe(false);
  });

  it('refuses to make a key from an empty or bad part', () => {
    expect(() => makeLocationKey('', '1')).toThrow(/Invalid location key/);
    expect(() => makeLocationKey('parkstay', '')).toThrow(/Invalid location key/);
    expect(() => makeLocationKey('Park:Stay', '1')).toThrow(/Invalid location key/);
  });
});
