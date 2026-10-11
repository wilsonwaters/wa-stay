/**
 * @jest-environment node
 *
 * The SMTP notifier's emails carry the WA Stay brand and name the provider they are about
 * (B2). nodemailer's transport is replaced so each test sees exactly what would be sent.
 */
import path from 'path';
import type Mail from 'nodemailer/lib/mailer';
import { SmtpEmailNotifier } from '@main/core/notifications/notifiers/email-smtp.notifier';
import { registerBuiltInProviders } from '@main/providers';
import { ProviderRegistry } from '@main/providers/registry';
import { BRAND_COLORS } from '@shared/constants';
import type { NotificationMessage } from '@shared/types';
import { createTestProviderContext } from '@tests/utils/fake-provider';

const mockSendMail = jest.fn(async (_options: Mail.Options) => ({ messageId: 'message-1' }));
const mockVerify = jest.fn(async () => true);
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail, verify: mockVerify })) },
}));

const SENDER = 'me@example.com';
const LOGO = path.resolve(__dirname, '../../../../resources/icons/email-logo.png');

/** Provider names come from the real registry, as the container wires them. */
function providerNames(): (id: string) => string | undefined {
  const registry = new ProviderRegistry();
  registerBuiltInProviders(registry, createTestProviderContext);
  return (id) => registry.tryGet(id)?.manifest.shortName;
}

function notifier(options: { logoPath?: string } = {}): SmtpEmailNotifier {
  const n = new SmtpEmailNotifier({ providerName: providerNames(), ...options });
  n.configure({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: SENDER, pass: 'app-password' },
  });
  return n;
}

/** Sends `message` and returns what nodemailer was given. */
async function sent(
  message: NotificationMessage,
  n: SmtpEmailNotifier = notifier()
): Promise<Mail.Options> {
  const result = await n.send(message);
  expect(result).toEqual({ success: true, messageId: 'message-1' });
  expect(mockSendMail).toHaveBeenCalledTimes(1);
  return mockSendMail.mock.calls[0][0];
}

const WATCH_FOUND: NotificationMessage = {
  title: 'Sites available at Dales',
  message: 'Found 2 sites available at Dales for 10/01/2027 - 12/01/2027',
  actionUrl: '/watches/7',
  providerId: 'parkstay',
  locationName: 'Dales',
};

beforeEach(() => {
  mockSendMail.mockClear();
  mockVerify.mockClear();
});

describe('SmtpEmailNotifier: sender and subject', () => {
  it('sends from "WA Stay" at the configured address', async () => {
    const mail = await sent(WATCH_FOUND);
    expect(mail.from).toBe(`"WA Stay" <${SENDER}>`);
    expect(mail.to).toBe(SENDER);
  });

  it('names the title and the provider, and the place only once', async () => {
    const mail = await sent(WATCH_FOUND);
    expect(mail.subject).toBe('WA Stay: Sites available at Dales · ParkStay');
  });

  it('adds the location when the title does not name it', async () => {
    const mail = await sent({ ...WATCH_FOUND, title: 'Booking confirmed' });
    expect(mail.subject).toBe('WA Stay: Booking confirmed · ParkStay · Dales');
  });

  it('leaves out a missing provider or location, and a provider the registry does not know', async () => {
    const cases: Array<[NotificationMessage, string]> = [
      [{ title: 'Error', message: 'x' }, 'WA Stay: Error'],
      [{ title: 'Held', message: 'x', locationName: 'Dales' }, 'WA Stay: Held · Dales'],
      [{ title: 'Held', message: 'x', providerId: 'parkstay' }, 'WA Stay: Held · ParkStay'],
      [
        { title: 'Held', message: 'x', providerId: 'nope', locationName: 'Dales' },
        'WA Stay: Held · Dales',
      ],
    ];
    for (const [message, subject] of cases) {
      mockSendMail.mockClear();
      expect((await sent(message)).subject).toBe(subject);
    }
  });

  it('names no provider when it was given no way to look one up', async () => {
    const n = new SmtpEmailNotifier();
    n.configure({ host: 'h', port: 587, secure: false, auth: { user: SENDER, pass: 'p' } });
    expect((await sent(WATCH_FOUND, n)).subject).toBe('WA Stay: Sites available at Dales');
  });
});

describe('SmtpEmailNotifier: body', () => {
  it('shows the WA Stay wordmark, the location and the provider, and says who sent it', async () => {
    const mail = await sent(WATCH_FOUND);
    const html = String(mail.html);
    expect(html).toMatch(/>\s*WA Stay\s*</);
    expect(html).toMatch(/Location: Dales/);
    expect(html).toMatch(/Provider: ParkStay/);
    expect(html).toContain('Sent by WA Stay');
    expect(html).not.toMatch(/Campground:|ParkStay Bookings/);

    expect(mail.text).toContain('Location: Dales\nProvider: ParkStay\n');
    expect(mail.text).toMatch(/^WA Stay\n/);
    expect(mail.text).toMatch(/Sent by WA Stay\.$/);
  });

  it('uses only D1 palette colours: ink text, coral button', async () => {
    const mail = await sent({ ...WATCH_FOUND, actionUrl: 'https://example.com/hold' });
    const html = String(mail.html);
    expect(html).not.toMatch(/2d5a27/i);

    const palette = new Set(Object.values(BRAND_COLORS).map((hex) => hex.toUpperCase()));
    const used = Array.from(html.matchAll(/#[0-9a-f]{3,6}\b/gi), (m) => m[0].toUpperCase());
    expect(used.length).toBeGreaterThan(5);
    expect(used.filter((hex) => !palette.has(hex))).toEqual([]);

    expect(html).toMatch(/<h2 style="[^"]*color: #15181D/);
    expect(html).toMatch(
      /<a href="https:\/\/example\.com\/hold"[^>]*background-color: #BF4520;[^>]*color: #FFFFFF;/
    );
  });

  it('escapes the message text', async () => {
    const mail = await sent({ title: '<b>Hi</b>', message: 'a & b', locationName: '"Dales"' });
    expect(mail.html).toContain('&lt;b&gt;Hi&lt;/b&gt;');
    expect(mail.html).toContain('a &amp; b');
    expect(mail.html).toContain('Location: &quot;Dales&quot;');
  });
});

describe('SmtpEmailNotifier: action links', () => {
  it('links an https URL, escaped, in both forms', async () => {
    const url = 'https://parkstay.dbca.wa.gov.au/pay?a=1&b="x"';
    const mail = await sent({ ...WATCH_FOUND, actionUrl: url });
    const href = /<a href="([^"]*)"/.exec(String(mail.html))?.[1];
    expect(href).toBe('https://parkstay.dbca.wa.gov.au/pay?a=1&amp;b=%22x%22');
    expect(mail.html).toContain('View details');
    expect(mail.text).toContain('View details: https://parkstay.dbca.wa.gov.au/pay?a=1&b=%22x%22');
  });

  it.each([
    ['javascript:alert(document.cookie)'],
    ['JAVASCRIPT:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['file:///etc/passwd'],
    ['/watches/7'],
    ['not a url'],
  ])('drops %s', async (actionUrl) => {
    const mail = await sent({ ...WATCH_FOUND, actionUrl });
    expect(mail.html).not.toContain('<a ');
    expect(mail.html).not.toContain('View details');
    expect(mail.html).not.toMatch(/javascript:|data:text|file:/i);
    expect(mail.text).not.toContain('View details');
  });
});

describe('SmtpEmailNotifier: logo', () => {
  it('shows the WA Stay icon inline beside the wordmark when the file exists', async () => {
    const mail = await sent(WATCH_FOUND, notifier({ logoPath: LOGO }));
    expect(mail.attachments).toEqual([
      { filename: 'wa-stay.png', path: LOGO, cid: 'wa-stay-logo' },
    ]);
    expect(mail.html).toContain('src="cid:wa-stay-logo"');
  });

  it('sends without it when the file is missing', async () => {
    const mail = await sent(
      WATCH_FOUND,
      notifier({ logoPath: path.join(__dirname, 'missing.png') })
    );
    expect(mail.attachments).toEqual([]);
    expect(mail.html).not.toContain('cid:');
  });
});

describe('SmtpEmailNotifier: test email', () => {
  it('sends a WA Stay test email in the same design', async () => {
    const result = await notifier({ logoPath: LOGO }).testConnection();

    expect(result.success).toBe(true);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.from).toBe(`"WA Stay" <${SENDER}>`);
    expect(mail.subject).toBe('WA Stay: Test email');
    expect(mail.text).toContain('This is a test email from WA Stay.');
    expect(mail.html).toContain('Sent by WA Stay');
    expect(mail.html).not.toMatch(/2d5a27|28a745|ParkStay Bookings/i);
    expect(mail.attachments).toHaveLength(1);
  });
});
