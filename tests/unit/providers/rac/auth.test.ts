/**
 * RAC's member number (`src/main/providers/rac/auth.ts`, `membership.ts`; terms rules 11, 12 and
 * 14; RS13): one secret, copyable field and three statements; a format check that sends
 * nothing and keeps the number as text (a leading zero survives); whether a number is saved as
 * a boolean, false with a warning that names no value when the saved one can't be read; and a
 * source guard: no RAC file but `membership.ts` reads the secret, and only it and `auth.ts`
 * name its key.
 *
 * Every number here is made up (`1234567890123`, `012345678`): never a real member number.
 */

import fs from 'fs';
import path from 'path';
import { racManifest } from '@main/providers/rac';
import {
  createRacAuth,
  normaliseMemberNumber,
  RAC_MEMBER_NUMBER_FIELD,
  RAC_MEMBER_NUMBER_REFUSED,
} from '@main/providers/rac/auth';
import {
  createMembership,
  hasMemberNumber,
  RAC_MEMBER_NUMBER_SECRET,
} from '@main/providers/rac/membership';
import type { HttpClient, ProviderContext } from '@main/providers/sdk';
import { SecretUnreadableError } from '@main/security/secret-vault';
import {
  RAC_CONFIRMATIONS,
  RAC_MEMBER_NUMBER_FIELD as RENDERER_FIELD,
} from '@tests/fixtures/renderer/settings';
import { createMemoryLogger, createTestProviderContext } from '@tests/utils/fake-provider';

const RAC_DIR = path.join(__dirname, '../../../../src/main/providers/rac');

/** An HttpClient that records any use: a member number check must never touch it. */
function untouchableHttp(): { http: HttpClient; touched: string[] } {
  const touched: string[] = [];
  const http = new Proxy({} as HttpClient, {
    get(_target, property) {
      touched.push(String(property));
      return () => {
        throw new Error(`The member number check used http.${String(property)}`);
      };
    },
  });
  return { http, touched };
}

function racContext(overrides: Partial<Omit<ProviderContext, 'id'>> = {}): ProviderContext {
  return createTestProviderContext(racManifest, { logger: createMemoryLogger(), ...overrides });
}

const signIn = (typed: string, http = untouchableHttp().http) =>
  createRacAuth(racContext()).signIn({ [RAC_MEMBER_NUMBER_FIELD]: typed }, http);

describe("RAC's member number sign-in (auth.ts)", () => {
  it('asks for one secret, copyable field, with its help, and three statements (rule 11)', () => {
    const auth = createRacAuth(racContext());
    expect(auth.kind).toBe('credentials');
    expect(auth.fields).toEqual([
      {
        key: 'memberNumber',
        label: 'RAC member number',
        help: "On your RAC card or in myRAC. Kept encrypted on this computer and never sent. You type it at RAC's checkout.",
        secret: true,
        copyable: true,
      },
    ]);
    expect(auth.confirmations?.map((confirmation) => confirmation.label)).toEqual([
      'This is my own RAC member number',
      'I will stay at the park myself',
      'I will book in the name on my RAC card',
    ]);
    expect(new Set(auth.confirmations?.map((confirmation) => confirmation.key)).size).toBe(3);
    // The renderer's tests describe RAC's account exactly as main does
    expect(auth.fields).toEqual([RENDERER_FIELD]);
    expect(auth.confirmations).toEqual(RAC_CONFIRMATIONS);
  });

  it.each([
    ['1234 5678', '12345678'],
    ['1234-5678', '12345678'],
    ['012345678', '012345678'],
    ['1234567890123', '1234567890123'],
    ['1234-5678-90123', '1234567890123'],
    ['1234', '1234'],
    ['1234567890123456', '1234567890123456'],
  ])('accepts %p, stored and copied as the text %p (a leading zero kept)', async (typed, kept) => {
    const { http, touched } = untouchableHttp();
    const answer = await signIn(typed, http);
    expect(answer).toEqual({ state: 'signed-in', values: { memberNumber: kept } });
    expect(typeof answer.values?.memberNumber).toBe('string');
    expect(touched).toEqual([]);
  });

  it.each([
    ['letters', 'abc'],
    ['digits and letters', '12AB34'],
    ['three digits', '123'],
    ['17 digits', '12345678901234567'],
    ['a dot', '1234.5678'],
    ['a plus', '+12345678'],
    ['nothing but spaces and hyphens', ' - - '],
  ])('refuses %s with its own words, quoting nothing, and sends nothing', async (_, typed) => {
    const { http, touched } = untouchableHttp();
    const answer = await signIn(typed, http);
    expect(answer).toEqual({ state: 'signed-out', message: RAC_MEMBER_NUMBER_REFUSED });
    expect(RAC_MEMBER_NUMBER_REFUSED).toBe("That doesn't look like an RAC member number");
    expect(touched).toEqual([]);
  });

  it('normalises without ever making a number of it', () => {
    expect(normaliseMemberNumber(' 0123 4567 ')).toBe('01234567');
    expect(normaliseMemberNumber('0000')).toBe('0000');
    expect(normaliseMemberNumber('١٢٣٤٥')).toBeUndefined();
    const source = fs.readFileSync(path.join(RAC_DIR, 'auth.ts'), 'utf8');
    expect(source).not.toMatch(/\bNumber\(|parseInt|parseFloat|\+values/);
  });

  it('stops when aborted, before it answers', async () => {
    const controller = new AbortController();
    controller.abort();
    const auth = createRacAuth(racContext());
    await expect(
      auth.signIn({ memberNumber: '1234567890123' }, untouchableHttp().http, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('isSignedIn: signed in while a number is saved, signed out otherwise, with no request', async () => {
    const ctx = racContext();
    const auth = createRacAuth(ctx);
    const { http, touched } = untouchableHttp();
    await expect(auth.isSignedIn(http)).resolves.toEqual({ state: 'signed-out' });
    await ctx.secrets.set(RAC_MEMBER_NUMBER_SECRET, '012345678');
    await expect(auth.isSignedIn(http)).resolves.toEqual({ state: 'signed-in' });
    await ctx.secrets.delete(RAC_MEMBER_NUMBER_SECRET);
    await expect(auth.isSignedIn(http)).resolves.toEqual({ state: 'signed-out' });
    expect(touched).toEqual([]);
  });

  it("isSignedIn: unknown, never signed out, when the saved number can't be read (R16 review)", async () => {
    const logger = createMemoryLogger();
    const ctx = racContext({
      logger,
      secrets: {
        get: () =>
          Promise.reject(new SecretUnreadableError('key-missing', 'The key file is missing')),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    });
    const { http, touched } = untouchableHttp();
    await expect(createRacAuth(ctx).isSignedIn(http)).resolves.toEqual({
      state: 'unknown',
      reason: 'unreadable',
    });
    // Everything else still counts it as none
    await expect(hasMemberNumber(ctx)).resolves.toBe(false);
    expect(touched).toEqual([]);
  });
});

describe('whether a member number is saved (membership.ts)', () => {
  it('is a boolean read from the scoped vault, under account.memberNumber', async () => {
    const ctx = racContext();
    expect(RAC_MEMBER_NUMBER_SECRET).toBe(`account.${RAC_MEMBER_NUMBER_FIELD}`);
    await expect(hasMemberNumber(ctx)).resolves.toBe(false);
    await ctx.secrets.set(RAC_MEMBER_NUMBER_SECRET, '1234567890123');
    await expect(hasMemberNumber(ctx)).resolves.toBe(true);
  });

  it('counts an unreadable number as none, with a warning that names no value', async () => {
    const logger = createMemoryLogger();
    const ctx = racContext({
      logger,
      secrets: {
        get: () =>
          Promise.reject(
            new SecretUnreadableError('decrypt-failed', 'Secret 1234567890123 could not be read')
          ),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    });
    await expect(hasMemberNumber(ctx)).resolves.toBe(false);
    expect(logger.lines).toEqual([
      expect.objectContaining({
        level: 'warn',
        message:
          "RAC: the saved member number can't be read (SecretUnreadableError); public prices and release times",
      }),
    ]);
    expect(JSON.stringify(logger.lines)).not.toContain('1234567890123');
  });

  it("shares the last answer for links, and counts an answer it can't get as no member", async () => {
    const logger = createMemoryLogger();
    let answer: () => Promise<boolean> = () => Promise.resolve(true);
    const membership = createMembership(() => answer(), logger);
    expect(membership.last()).toBe(false);
    await expect(membership.read()).resolves.toBe(true);
    expect(membership.last()).toBe(true);
    answer = () => Promise.reject(new TypeError('012345678 is not saved'));
    await expect(membership.read()).resolves.toBe(false);
    expect(membership.last()).toBe(false);
    expect(logger.lines.map((line) => line.message)).toEqual([
      'RAC: could not tell whether a member number is saved (TypeError); public prices and release times',
    ]);
  });
});

describe('the member number stays in two files (source guard, rule 12)', () => {
  const sources = fs
    .readdirSync(RAC_DIR)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => [file, fs.readFileSync(path.join(RAC_DIR, file), 'utf8')] as const);

  it('reads every RAC source file', () => {
    expect(sources.map(([file]) => file)).toEqual(
      expect.arrayContaining(['auth.ts', 'membership.ts', 'availability.ts', 'index.ts'])
    );
  });

  it('only membership.ts and auth.ts name account.memberNumber', () => {
    const naming = sources
      .filter(([, text]) => text.includes('account.memberNumber'))
      .map(([file]) => file);
    expect(naming.sort()).toEqual(['auth.ts', 'membership.ts']);
  });

  it('only membership.ts reads the secret vault', () => {
    // `ctx.secrets.get(…)` and the like; auth.ts only passes its context on to membership.ts
    const reading = sources.filter(([, text]) => /\.secrets\b/.test(text)).map(([file]) => file);
    expect(reading).toEqual(['membership.ts']);
  });
});
