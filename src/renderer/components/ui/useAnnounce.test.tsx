import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnnouncerProvider, useAnnounce } from './useAnnounce';

function Results() {
  const announce = useAnnounce();
  return (
    <>
      <button type="button" onClick={() => announce('3 results')}>
        Search
      </button>
      <button type="button" onClick={() => announce('Hold expires in 1 minute', 'assertive')}>
        Warn
      </button>
    </>
  );
}

const liveRegion = (politeness: 'polite' | 'assertive') =>
  document.body.querySelector(`[aria-live="${politeness}"]`) as HTMLElement;

describe('useAnnounce', () => {
  it("useAnnounce('3 results') updates a polite live region outside #root", async () => {
    render(
      <AnnouncerProvider>
        <Results />
      </AnnouncerProvider>
    );
    const polite = liveRegion('polite');
    expect(polite).toBeEmptyDOMElement();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(polite).toHaveTextContent('3 results');
    expect(polite).toHaveAttribute('aria-atomic', 'true');
    // Portalled to body, so a modal's inert #root never silences it.
    expect(polite.parentElement).toBe(document.body);
  });

  it('changes the region text again when the same message repeats', async () => {
    render(
      <AnnouncerProvider>
        <Results />
      </AnnouncerProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    const first = liveRegion('polite').textContent;
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(liveRegion('polite').textContent).not.toBe(first);
    expect(liveRegion('polite')).toHaveTextContent('3 results');
  });

  it('uses the assertive region when asked', async () => {
    render(
      <AnnouncerProvider>
        <Results />
      </AnnouncerProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Warn' }));
    expect(liveRegion('assertive')).toHaveTextContent('Hold expires in 1 minute');
    expect(liveRegion('polite')).toBeEmptyDOMElement();
  });

  it('throws a clear error outside the provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      act(() => {
        render(<Results />);
      })
    ).toThrow(/AnnouncerProvider/);
    spy.mockRestore();
  });
});
