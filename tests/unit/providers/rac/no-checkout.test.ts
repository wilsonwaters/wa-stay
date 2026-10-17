/**
 * Terms rule 8 in RAC's source (R19): payment and acceptance are the person's steps, so no RAC
 * module may name checkout's or the card store's words. Only the cart guard
 * (`src/main/providers/rac/cart-guard.ts`) names them, and only in its deny list, to refuse
 * them. Each check is a function, run over the files and over a bad sample.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../../../..');
const SOURCE_DIR = path.join(ROOT, 'src/main/providers/rac');
const GUARD = 'cart-guard.ts';
/** Checkout's, the card store's and NewBook's hold and membership words (rule 8). */
const CHECKOUT_WORDS = [
  'cc_secure',
  'card_number',
  'card_cvv',
  'newbook_online_main_form',
  'cart=Booking',
  'extend_multiple_holds',
  'membership_number',
];
const DENY_LIST = /const DENY_LIST\b[^=]*=\s*\[([\s\S]*?)\];/;

/** The checkout words `text` names. */
const named = (text: string): string[] => CHECKOUT_WORDS.filter((word) => text.includes(word));

/** The guard's deny list, and the guard with it taken out. */
function splitGuard(text: string): { list: string; rest: string } {
  const match = DENY_LIST.exec(text);
  return match ? { list: match[1], rest: text.replace(match[0], '') } : { list: '', rest: text };
}

const sources = fs
  .readdirSync(SOURCE_DIR)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => [file, fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8')] as const);

describe('RAC source names no checkout (terms rule 8)', () => {
  it('has the module files, the guard among them', () => {
    expect(sources.map(([file]) => file)).toEqual(
      expect.arrayContaining([GUARD, 'holds.ts', 'cart-page.ts', 'client.ts'])
    );
  });

  it.each(sources.filter(([file]) => file !== GUARD))('%s names none of them', (_file, text) => {
    expect(named(text)).toEqual([]);
  });

  it(`${GUARD} names every one, in its deny list only`, () => {
    const [, text] = sources.find(([file]) => file === GUARD)!;
    const { list, rest } = splitGuard(text);
    expect(named(list)).toEqual(CHECKOUT_WORDS);
    expect(named(rest)).toEqual([]);
  });

  it('catches what it guards against', () => {
    expect(named("const url = '/cc_secure/1230';")).toEqual(['cc_secure']);
    expect(named("form.set('membership_number', number);")).toEqual(['membership_number']);
    expect(named("const step = '?cart=Booking';")).toEqual(['cart=Booking']);
    const guard = splitGuard(
      "const DENY_LIST: readonly string[] = [\n  'card_cvv',\n];\n// also card_cvv here\n"
    );
    expect(named(guard.list)).toEqual(['card_cvv']);
    expect(named(guard.rest)).toEqual(['card_cvv']);
  });
});

/**
 * The payment window never fills in or injects the member number (R16's review, routed to
 * R19): the person copies it with "Copy RAC member number" and types it at RAC's checkout. The
 * window and the code that opens it run no script in the page, type nothing into it, and never
 * read a provider's saved details.
 */
describe('the payment window never fills in the member number', () => {
  const FILLING = [
    'executeJavaScript',
    'insertText',
    'sendInputEvent',
    'secretsOf',
    'copyCredential',
    'account.memberNumber',
  ];
  const filling = (text: string): string[] => FILLING.filter((word) => text.includes(word));
  const files = [
    'src/main/app/provider-windows.ts',
    ...fs
      .readdirSync(path.join(ROOT, 'src/main/core/holds'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => `src/main/core/holds/${file}`),
    // RAC's cart: its holds, its cart page, its guard and its client
    ...['holds.ts', 'cart-page.ts', 'cart-guard.ts', 'client.ts'].map(
      (file) => `src/main/providers/rac/${file}`
    ),
  ];

  it.each(files.map((file) => [file]))('%s scripts no page and reads no saved detail', (file) => {
    expect(filling(fs.readFileSync(path.join(ROOT, file), 'utf8'))).toEqual([]);
  });

  it('catches what it guards against', () => {
    expect(filling("win.webContents.executeJavaScript('fill()')")).toEqual(['executeJavaScript']);
    expect(filling('registry.secretsOf(id)')).toEqual(['secretsOf']);
  });
});
