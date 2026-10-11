import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { currentRoute, getBanners, renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { AppErrorBoundary, errorDetails } from './ErrorBoundary';

// A page and a header component that can be told to throw while rendering.
const failures = { page: false, header: false };

jest.mock('../features/bookings/BookingsPage', () => {
  function BookingsPage() {
    if (failures.page) throw new Error('Bookings list exploded');
    return <h1>Bookings</h1>;
  }
  return { __esModule: true, BookingsPage, default: BookingsPage };
});

jest.mock('../features/notifications/NotificationBell', () => ({
  __esModule: true,
  NotificationBell: function NotificationBell() {
    if (failures.header) throw new Error('Bell exploded');
    return <button type="button">Notifications</button>;
  },
}));

let consoleError: jest.SpyInstance;
beforeEach(() => {
  failures.page = false;
  failures.header = false;
  // React logs every caught render error; the boundary also logs it on purpose.
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => consoleError.mockRestore());

describe('RouteErrorBoundary', () => {
  it('shows the route error panel while the header stays usable, and Explore clears it', async () => {
    failures.page = true;
    const { user } = renderWithApp();
    await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' });

    await user.click(screen.getByRole('link', { name: 'Bookings, coming soon' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This page hit a problem' })
    ).toBeInTheDocument();
    expect(screen.getByText('Bookings list exploded')).toBeInTheDocument();
    // The shell is still there and works.
    expect(getBanners()).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Bookings, coming soon' })).toHaveAttribute(
      'aria-current',
      'page'
    );

    await user.click(screen.getByRole('link', { name: 'Explore' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'This page hit a problem' })).toBeNull();
    expect(screen.queryByText('Bookings list exploded')).toBeNull();
    expect(currentRoute()).toBe('/');
  });

  it('recovers with "Try again" once the page renders, and offers a way back', async () => {
    failures.page = true;
    const { user } = renderWithApp({ route: '/bookings' });
    await screen.findByRole('heading', { level: 1, name: 'This page hit a problem' });
    expect(screen.getByRole('button', { name: 'Back to Explore' })).toBeInTheDocument();

    failures.page = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bookings' })).toBeInTheDocument();
  });
});

describe('AppErrorBoundary', () => {
  it('catches an error in the header and offers a reload and the error details', async () => {
    failures.header = true;
    renderWithApp();
    expect(
      await screen.findByRole('heading', { name: 'WA Stay hit a problem' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload WA Stay' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy error details' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
  });

  it('reloads, and copies the error details to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const onReload = jest.fn();
    function Broken(): JSX.Element {
      throw new Error('Tray exploded');
    }
    render(
      <AppErrorBoundary onReload={onReload}>
        <Broken />
      </AppErrorBoundary>
    );

    await user.click(screen.getByRole('button', { name: 'Reload WA Stay' }));
    expect(onReload).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Copy error details' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('Error: Tray exploded');
    expect(screen.getByRole('status')).toHaveTextContent('Error details copied.');
  });

  it('says so when the clipboard refuses', async () => {
    const user = userEvent.setup();
    jest.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    function Broken(): JSX.Element {
      throw new Error('Tray exploded');
    }
    render(
      <AppErrorBoundary onReload={jest.fn()}>
        <Broken />
      </AppErrorBoundary>
    );
    await user.click(screen.getByRole('button', { name: 'Copy error details' }));
    expect(await screen.findByText("Couldn't copy the error details.")).toBeInTheDocument();
  });
});

describe('errorDetails', () => {
  it('includes the message, stack and component stack', () => {
    const error = new Error('Boom');
    const text = errorDetails(error, '\n    at Tray');
    expect(text).toContain('Error: Boom');
    expect(text).toContain('Stack:');
    expect(text).toContain('Components:');
    expect(text).toContain('at Tray');
  });
});
