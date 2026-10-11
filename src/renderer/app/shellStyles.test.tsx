/**
 * Shell CSS, checked against the real stylesheet: src/renderer/styles/index.css compiled with
 * Tailwind, applied in jsdom and read back with getComputedStyle.
 */
import { render, screen } from '@testing-library/react';
import { compileStylesheet } from '@tests/utils/tailwind';

let style: HTMLStyleElement;

beforeAll(async () => {
  style = document.createElement('style');
  style.textContent = await compileStylesheet({ unlayered: true });
  document.head.appendChild(style);
});

afterAll(() => style.remove());

/**
 * Focuses `el` and returns its computed style. jsdom 26 caches computed styles until the DOM
 * changes, and focus is not a DOM change; role queries have already computed (and cached) the
 * unfocused style. An attribute change after focusing clears the cache, as a browser restyles.
 */
function focusedStyle(el: HTMLElement): CSSStyleDeclaration {
  el.focus();
  el.setAttribute('data-restyle', '');
  el.removeAttribute('data-restyle');
  return getComputedStyle(el);
}

describe('focus ring', () => {
  it('is not drawn on a heading that took focus from code (tabindex -1)', () => {
    render(
      <>
        <h1 tabIndex={-1}>Watches</h1>
        <h2 tabIndex={-1}>Section</h2>
      </>
    );
    for (const heading of screen.getAllByRole('heading')) {
      const outline = focusedStyle(heading).outline;
      expect(heading).toHaveFocus();
      expect(outline).toBe('none');
    }
  });

  it('is still drawn on anything a person can Tab to', () => {
    render(
      <>
        <button type="button">Save</button>
        <a href="#/watches">Watches</a>
      </>
    );
    for (const el of [screen.getByRole('button'), screen.getByRole('link')]) {
      expect(focusedStyle(el).outline).toMatch(/^2px solid rgb\(var\(--ws-focus\)\)/);
    }
  });
});
