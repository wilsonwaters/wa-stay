import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComingSoonBanner, comingSoonStorageKey } from './ComingSoonBanner';

function Page({ feature = 'Site Sniper' }: { feature?: string }) {
  return (
    <main>
      <h1>{feature}</h1>
      <ComingSoonBanner featureName={feature} />
    </main>
  );
}

beforeEach(() => window.localStorage.clear());

describe('ComingSoonBanner', () => {
  it('says the feature works but is still being finalised, with an icon and no emoji', () => {
    render(<Page feature="Bookings" />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(
      'Bookings is still being finalised. It works, but expect rough edges.'
    );
    expect(banner.querySelector('svg')).not.toBeNull();
    expect(banner.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('has a labelled dismiss button; dismissing persists under the legacy key format', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Page feature="Site Sniper" />);
    await user.click(screen.getByRole('button', { name: 'Dismiss the Site Sniper notice' }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(window.localStorage.getItem('comingSoonDismissed_Site_Sniper')).toBe('true');
    // Focus goes to the page's heading, not the body.
    expect(screen.getByRole('heading', { level: 1, name: 'Site Sniper' })).toHaveFocus();

    unmount();
    render(<Page feature="Site Sniper" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stays hidden for a dismissal stored by an earlier version', () => {
    window.localStorage.setItem('comingSoonDismissed_Bookings', 'true');
    render(<Page feature="Bookings" />);
    expect(screen.queryByText(/still being finalised/)).toBeNull();
    expect(comingSoonStorageKey('Site Sniper')).toBe('comingSoonDismissed_Site_Sniper');
  });

  it('still shows, and still hides on dismiss, when storage is blocked', async () => {
    const user = userEvent.setup();
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      render(<Page feature="Bookings" />);
      await user.click(screen.getByRole('button', { name: 'Dismiss the Bookings notice' }));
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
