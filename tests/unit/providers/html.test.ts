/**
 * `sanitizeProviderHtml`: what a provider's description may keep before it crosses IPC.
 */

import { sanitizeProviderHtml } from '@main/providers/sdk/html';
import { parkStayFixture } from '@tests/utils/parkstay-fixture-server';

const BASE = 'https://parkstay.dbca.wa.gov.au';

describe('sanitizeProviderHtml', () => {
  it("cleans Bungarra's long_description: no style block, no style or class attributes", () => {
    const html: string = parkStayFixture('campsite_availablity_view_20.json').long_description;
    expect(html).toMatch(/<style|style=|class=/);

    const clean = sanitizeProviderHtml(html, BASE);

    expect(clean).not.toMatch(/<style|style=|class=/);
    expect(clean).toContain(
      '<img src="https://parkstay.dbca.wa.gov.au/media/parkstay/campground_images/25f050a7-6c3.jpg" alt="" />'
    );
    // Its headings (h4 at most) nest under the page's sections: the highest becomes h3.
    expect(clean).toContain('<h3><strong>This campground is in the Gascoyne Region</strong></h3>');
    // The CSS rules inside <style> are gone too, not left as text.
    expect(clean).not.toContain('text-decoration');
  });

  it('drops scripts, iframes and event handlers', () => {
    const clean = sanitizeProviderHtml(
      '<p onclick="steal()">Hi<script>alert(1)</script></p><iframe src="https://x.example"></iframe><img src="/a.jpg" onerror="x()">',
      BASE
    );
    expect(clean).toBe('<p>Hi</p><img src="https://parkstay.dbca.wa.gov.au/a.jpg" alt="" />');
  });

  it('keeps only the allowed tags, keeping the text of the others', () => {
    const clean = sanitizeProviderHtml(
      '<section>Big</section><table><tr><td>cell</td></tr></table><ul><li><em>a</em></li></ul><hr><br>',
      BASE
    );
    expect(clean).toBe('Bigcell<ul><li><em>a</em></li></ul><hr /><br />');
  });

  it('keeps presentational bold and italic as strong and em, and is stable when run again', () => {
    const once = sanitizeProviderHtml('<p><b>Bookings open monthly</b> and <i>fill fast</i>.</p>');
    expect(once).toBe('<p><strong>Bookings open monthly</strong> and <em>fill fast</em>.</p>');
    expect(sanitizeProviderHtml(once)).toBe(once);
  });

  it("nests the provider's headings under the page's sections, keeping their depth", () => {
    expect(sanitizeProviderHtml('<h1 class="x">A</h1><h2>B</h2><h4>C</h4><h6>D</h6>', BASE)).toBe(
      '<h3>A</h3><h4>B</h4><h6>C</h6><h6>D</h6>'
    );
    // Headings that start lower move up, so the first is never more than one below the h2.
    expect(sanitizeProviderHtml('<h4>Where</h4><p>x</p><h5>Road</h5>', BASE)).toBe(
      '<h3>Where</h3><p>x</p><h4>Road</h4>'
    );
    expect(sanitizeProviderHtml('<h3>Only</h3>', BASE)).toBe('<h3>Only</h3>');
  });

  it('nests headings lower under a section’s own title with topHeading, never past h6', () => {
    expect(sanitizeProviderHtml('<h6>A</h6><p>x</p>', BASE, { topHeading: 4 })).toBe(
      '<h4>A</h4><p>x</p>'
    );
    expect(sanitizeProviderHtml('<h1>A</h1><h3>B</h3><h5>C</h5>', BASE, { topHeading: 4 })).toBe(
      '<h4>A</h4><h6>B</h6><h6>C</h6>'
    );
    // Sanitising again with the same level changes nothing.
    expect(sanitizeProviderHtml('<h4>A</h4><h5>B</h5>', BASE, { topHeading: 4 })).toBe(
      '<h4>A</h4><h5>B</h5>'
    );
    // Out of range or not a number: clamped to 3–6, or the default.
    expect(sanitizeProviderHtml('<h1>A</h1>', BASE, { topHeading: 1 })).toBe('<h3>A</h3>');
    expect(sanitizeProviderHtml('<h1>A</h1>', BASE, { topHeading: 9 })).toBe('<h6>A</h6>');
    expect(sanitizeProviderHtml('<h1>A</h1>', BASE, { topHeading: NaN })).toBe('<h3>A</h3>');
  });

  it('leaves out images the page already shows, however their address is written', () => {
    const gallery = [`${BASE}/media/parkstay/campground_images/a.jpg`];
    expect(
      sanitizeProviderHtml(
        '<p>See</p><img src="/media/parkstay/campground_images/a.jpg"><img src="/media/b.jpg" alt="Map">',
        BASE,
        { dropImages: gallery }
      )
    ).toBe(`<p>See</p><img src="${BASE}/media/b.jpg" alt="Map" />`);
  });

  it('makes links absolute, keeps only https ones, and adds rel="noopener noreferrer"', () => {
    const clean = sanitizeProviderHtml(
      '<a href="/park" target="_top">park</a> <a href="javascript:alert(1)" target="_blank">js</a> <a href="http://insecure.example/">http</a>',
      BASE
    );
    expect(clean).toBe(
      '<a href="https://parkstay.dbca.wa.gov.au/park" target="_blank" rel="noopener noreferrer">park</a> ' +
        '<a rel="noopener noreferrer">js</a> <a rel="noopener noreferrer">http</a>'
    );
  });

  it('opens every link with an href in a new window, which the app sends to the browser', () => {
    expect(
      sanitizeProviderHtml('<p>See <a href="https://exploreparks.example/x">this</a></p>', BASE)
    ).toBe(
      '<p>See <a href="https://exploreparks.example/x" target="_blank" rel="noopener noreferrer">this</a></p>'
    );
  });

  it('drops images whose source is not https, keeps alt text, and marks the rest decorative', () => {
    expect(
      sanitizeProviderHtml(
        '<img src="http://x.example/a.jpg"><img src="data:image/png;base64,AA">',
        BASE
      )
    ).toBe('');
    expect(sanitizeProviderHtml('<img src="b.jpg" alt="Beach" width="9">', `${BASE}/media/`)).toBe(
      '<img src="https://parkstay.dbca.wa.gov.au/media/b.jpg" alt="Beach" />'
    );
  });
});
