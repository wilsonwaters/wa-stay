/**
 * ParkStay's campground page: the sections of "MORE DETAILS" and the notices, read from the
 * trimmed live page (`campground_page_20.html`, Bungarra, 10 Oct 2026), and every page that
 * comes back instead: the DBCA queue, a redirect away, the "Oops!" page, a closure and a
 * changed layout.
 */

import {
  CAMPGROUND_PAGE_PATH,
  fetchCampgroundPage,
  readCampgroundPage,
} from '@main/providers/parkstay/campground-page';
import { isWaitingRoomPage, ParkStayClient } from '@main/providers/parkstay/client';
import { CHROME_USER_AGENT, NodeHttpClient } from '@main/providers/sdk';
import { createMemoryLogger } from '@tests/utils/fake-provider';
import {
  readParkStayFixture,
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';

const PAGE_URL = `https://parkstay.dbca.wa.gov.au${CAMPGROUND_PAGE_PATH}?site_id=20`;
const page = (body: string, url = PAGE_URL) => ({ url, body });
const bungarra = () => readParkStayFixture('campground_page_20.html');

describe('readCampgroundPage', () => {
  const result = readCampgroundPage(page(bungarra()));
  const sections = result.ok ? result.sections : [];
  const section = (title: string) => sections.find((s) => s.title === title)?.html ?? '';

  it('reads the intro and every h5 section, in the page’s order', () => {
    expect(result.ok).toBe(true);
    expect(sections.map((s) => s.title)).toEqual([
      'Overview',
      'Booking',
      'Campsites',
      'Facilities',
      'Campground Rules',
      'Fees',
      'Your safety and health',
      'Location',
    ]);
  });

  it('leaves the name and the photo carousel out of the intro', () => {
    expect(section('Overview')).toBe(
      '<p>Bungarra is a small campground 600m walk from a special purpose zone of Ningaloo ' +
        'Marine Park where shore-based fishing is permitted.</p>'
    );
  });

  it('sanitises each section: no class, style or script, https links that open in the browser', () => {
    for (const { html } of sections) {
      expect(html).not.toMatch(/class=|style=|<script|<img|<h[1-3]\b|<p>\s*<\/p>/);
    }
    expect(section('Booking')).toContain(
      '<a href="https://www.education.wa.edu.au/" target="_blank" rel="noopener noreferrer">' +
        'Western Australia public school holidays</a>'
    );
    expect(section('Booking')).toContain('<li>online and at this website only</li>');
    expect(section('Fees')).toContain('<li>Thursday 25 - Sunday 28 March 2027</li>');
  });

  it('nests a section’s own headings under its title, from h4', () => {
    expect(section('Facilities')).toContain('<h4>Milyering Visitor Centre</h4>');
  });

  it('reads the notices with their levels from the icons, and nothing from other round boxes', () => {
    expect(result.ok && result.notices).toEqual([
      { level: 'warning', text: 'Drinking water not supplied: bring your own' },
      { level: 'warning', text: 'No dump point: carry portable toilet waste out' },
      { level: 'warning', text: 'No campfires at any time' },
      { level: 'warning', text: 'No dogs or other domestic animals' },
      { level: 'warning', text: 'No generators' },
      { level: 'caution', text: 'No-flush pit toilets only' },
      {
        level: 'caution',
        text: 'SEASONAL CLOSURE FROM 1 NOVEMBER 2026, REOPENING ON 15 MARCH 2027',
      },
      { level: 'info', text: 'Book now for stays to 30 April 2027' },
      { level: 'info', text: 'Bookings for May 2027 open 10AM AWST Tuesday 3 November 2026' },
      { level: 'info', text: "Additional per-vehicle entry fee shown after 'Book now'" },
      {
        level: 'info',
        text: "To pay entry fee separately: deselect 'Pay park entry' at next screen",
      },
    ]);
  });

  it('gives no notices when the page has none', () => {
    const plain = bungarra().replace(
      /bi-(exclamation-diamond|exclamation-triangle|info-circle)-fill/g,
      'bi-x'
    );
    expect(readCampgroundPage(page(plain))).toMatchObject({ ok: true, notices: [] });
  });

  it('reads notice text as text: entities decoded, nothing kept as markup', () => {
    const html =
      '<div class="round-box"><div><i class="bi-info-circle-fill"></i>' +
      '<span>Tracks &amp; trails &lt;b&gt;closed</span></div></div>' +
      '<div id="campground-details"><h1>X</h1><p>Intro.</p></div>';
    expect(readCampgroundPage(page(html))).toEqual({
      ok: true,
      sections: [{ title: 'Overview', html: '<p>Intro.</p>' }],
      notices: [{ level: 'info', text: 'Tracks & trails <b>closed' }],
    });
  });

  describe('falls back (no sections) for', () => {
    it('a page reached by a redirect away from the campground page, whatever it shows', () => {
      const information = 'https://parkstay.dbca.wa.gov.au/search-availability/information/';
      expect(
        readCampgroundPage(
          page(readParkStayFixture('campground_page_redirected.html'), information)
        )
      ).toEqual({
        ok: false,
        problem: 'redirected',
      });
      expect(readCampgroundPage(page(bungarra(), `${information}?site_id=20`))).toEqual({
        ok: false,
        problem: 'redirected',
      });
    });

    it('the "Oops!" page shown while a booking is in progress', () => {
      expect(readCampgroundPage(page(readParkStayFixture('campground_page_oops.html')))).toEqual({
        ok: false,
        problem: 'booking-in-progress',
      });
    });

    it('a site closure message', () => {
      const closure =
        '<div class="container" style="z-index:1"><div class="alert alert-warning">' +
        'ParkStay is closed for maintenance.</div></div>';
      expect(readCampgroundPage(page(closure))).toEqual({ ok: false, problem: 'no-details' });
    });

    it('a changed layout: no #campground-details, or no section in it', () => {
      const renamed = bungarra().replace('id="campground-details"', 'id="campground-info"');
      expect(readCampgroundPage(page(renamed))).toEqual({ ok: false, problem: 'no-details' });
      const empty =
        '<div id="campground-details"><br><h1>Bungarra</h1>' +
        '<div id="carouselExampleCaptions" class="carousel slide"><img src="/x.jpg" alt="..."></div>' +
        '<p></p></div>';
      expect(readCampgroundPage(page(empty))).toEqual({ ok: false, problem: 'no-sections' });
    });
  });
});

describe('isWaitingRoomPage', () => {
  it('knows the queue’s redirect page, and not the campground page’s own window.location.replace', () => {
    expect(isWaitingRoomPage('text/html', readParkStayFixture('queue-interstitial.html'))).toBe(
      true
    );
    expect(bungarra()).toContain("window.location.replace('/search-availability/information/?'");
    expect(isWaitingRoomPage('text/html; charset=utf-8', bungarra())).toBe(false);
    expect(
      isWaitingRoomPage('application/json', readParkStayFixture('queue-interstitial.html'))
    ).toBe(false);
  });
});

describe('fetchCampgroundPage', () => {
  let server: ParkStayFixtureServer;
  let client: ParkStayClient;

  beforeAll(async () => {
    server = await startParkStayFixtureServer();
    client = new ParkStayClient(
      new NodeHttpClient({ providerId: 'parkstay' }),
      'parkstay',
      server.endpoints
    );
  });

  afterAll(async () => {
    await server.close();
  });

  afterEach(() => {
    server.queueGate = 'off';
    server.pages.clear();
  });

  const fetchPage = (logger = createMemoryLogger(), signal?: AbortSignal) =>
    fetchCampgroundPage(client, '20', logger, signal);

  it('sends one GET for the campground, as a browser with the ParkStay Referer', async () => {
    const before = server.requestsTo(CAMPGROUND_PAGE_PATH).length;
    const details = await fetchPage();
    const sent = server.requestsTo(CAMPGROUND_PAGE_PATH).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('GET');
    expect(Object.fromEntries(sent[0].query)).toEqual({ site_id: '20' });
    expect(sent[0].headers.referer).toBe('https://parkstay.dbca.wa.gov.au/');
    expect(sent[0].headers['user-agent']).toBe(CHROME_USER_AGENT);
    expect(sent[0].headers.accept).toMatch(/^text\/html/);
    expect(details?.sections).toHaveLength(8);
    expect(details?.notices).toHaveLength(11);
  });

  const cases: Array<[string, () => void, RegExp]> = [
    ['the queue’s waiting-room page', () => (server.queueGate = 'html'), /the DBCA queue answered/],
    [
      'a redirect to the waiting room',
      () => (server.queueGate = 'redirect'),
      /the DBCA queue answered/,
    ],
    [
      'a redirect away (the Referer refused)',
      () => server.pages.set('20', { redirect: '/' }),
      /sent the request to another page \(\/search-availability\/information\/\)/,
    ],
    [
      'the "Oops!" page',
      () => server.pages.set('20', { body: readParkStayFixture('campground_page_oops.html') }),
      /"Oops!" page/,
    ],
    [
      'a changed layout',
      () => server.pages.set('20', { body: bungarra().replace(/campground-details/g, 'details') }),
      /no campground details/,
    ],
    [
      'an HTTP error',
      () => server.pages.set('20', { status: 500, body: '<h1>Server Error (500)</h1>' }),
      /HTTP 500/,
    ],
  ];

  it.each(cases)(
    'gives nothing for %s, logging why without the query',
    async (_name, arrange, reason) => {
      arrange();
      const logger = createMemoryLogger();
      await expect(fetchPage(logger)).resolves.toBeUndefined();
      expect(logger.lines).toHaveLength(1);
      const [line] = logger.lines;
      expect(line.level).toBe('warn');
      expect(line.message).toMatch(reason);
      expect(line.message).toContain('ParkStay campground 20');
      expect(line.message).not.toMatch(/\?|site_id|arrival|cookie/i);
      expect(line.meta).toEqual([]);
    }
  );

  it('rejects only when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchPage(createMemoryLogger(), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
