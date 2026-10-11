import { useEffect, useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';
import { Portal } from './Portal';
import {
  MAX_VISIBLE_TOASTS,
  TOAST_DEDUPE_MS,
  ToastProvider,
  ToastStore,
  ToastViewport,
  useToast,
  type ToastApi,
} from './Toast';

let api: ToastApi;

function Capture() {
  api = useToast();
  return null;
}

/** Re-renders every second, like the Site Sniper countdown that broke the old toasts. */
function Ticking() {
  const [now, setNow] = useState(0);
  const toast = useToast();
  useEffect(() => {
    const timer = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <p>Tick {now}</p>
      <button type="button" onClick={() => toast.success('Snipe armed')}>
        Arm
      </button>
    </>
  );
}

function renderToasts(children: React.ReactNode = null) {
  return render(
    <ToastProvider>
      <Capture />
      {children}
      <ToastViewport />
    </ToastProvider>
  );
}

const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

const region = () => screen.getByRole('region', { name: 'Notifications' });
/** The polite live region inside the viewport that toasts are inserted into. */
const liveList = () => within(region()).getByRole('list');

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Toast', () => {
  it('auto-dismisses at 5 s even while the parent re-renders every second (Toast.tsx:48 regression)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderToasts(<Ticking />);
    await user.click(screen.getByRole('button', { name: 'Arm' }));
    expect(within(region()).getByRole('status')).toHaveTextContent('Snipe armed');

    advance(4000);
    expect(screen.getByText('Tick 4')).toBeInTheDocument();
    expect(screen.getByText('Snipe armed')).toBeInTheDocument();

    advance(1100);
    expect(screen.getByText('Tick 5')).toBeInTheDocument();
    expect(screen.queryByText('Snipe armed')).not.toBeInTheDocument();
  });

  it('inserts toasts into a polite live region that exists before the first toast', () => {
    renderToasts();
    const list = liveList();
    expect(list).toHaveAttribute('aria-live', 'polite');
    expect(within(list).queryAllByRole('listitem')).toHaveLength(0);

    act(() => {
      api.success('Watch saved');
      api.error('Hold failed');
    });
    // The same element: the live region was not re-created along with its content.
    expect(liveList()).toBe(list);
    expect(within(list).getByRole('status')).toHaveTextContent('Watch saved');
    expect(within(list).getByRole('alert')).toHaveTextContent('Hold failed');
  });

  it('uses 5 s for info and 8 s for warnings', () => {
    renderToasts();
    act(() => {
      api.info('Catalogue refreshed');
      api.warning('ParkStay is slow today');
    });
    advance(5000);
    expect(screen.queryByText('Catalogue refreshed')).not.toBeInTheDocument();
    expect(screen.getByText('ParkStay is slow today')).toBeInTheDocument();
    advance(3000);
    expect(screen.queryByText('ParkStay is slow today')).not.toBeInTheDocument();
  });

  it('keeps an error until it is dismissed, and announces it as an alert', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderToasts();
    act(() => {
      api.error("ParkStay didn't respond. Try again in a minute.");
    });
    advance(60_000);
    const alert = within(region()).getByRole('alert');
    expect(alert).toHaveTextContent("ParkStay didn't respond");
    await user.click(within(alert).getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows at most three; a fourth queues until one closes', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderToasts();
    act(() => {
      api.error('First');
      api.error('Second');
      api.error('Third');
      api.success('Fourth');
    });
    expect(within(region()).getAllByRole('alert')).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(screen.queryByText('Fourth')).not.toBeInTheDocument();

    // The queued toast's timer has not started: it still gets its full 5 s once shown.
    advance(10_000);
    const [first] = within(region()).getAllByRole('alert');
    await user.click(within(first).getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.getByText('Fourth')).toBeInTheDocument();
    advance(4900);
    expect(screen.getByText('Fourth')).toBeInTheDocument();
    advance(200);
    expect(screen.queryByText('Fourth')).not.toBeInTheDocument();
  });

  it('pauses its timer while hovered or focused', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderToasts();
    act(() => {
      api.success('Watch saved');
    });
    const toast = within(region()).getByRole('status');
    advance(3000);
    await user.hover(toast);
    advance(10_000);
    expect(screen.getByText('Watch saved')).toBeInTheDocument();
    await user.unhover(toast);
    advance(1900);
    expect(screen.getByText('Watch saved')).toBeInTheDocument();

    act(() => {
      within(toast).getByRole('button', { name: 'Dismiss notification' }).focus();
    });
    advance(10_000);
    expect(screen.getByText('Watch saved')).toBeInTheDocument();
    act(() => {
      within(toast).getByRole('button', { name: 'Dismiss notification' }).blur();
    });
    advance(200);
    expect(screen.queryByText('Watch saved')).not.toBeInTheDocument();
  });

  it('deduplicates the same message fired twice within a second', () => {
    renderToasts();
    let a = '';
    let b = '';
    let c = '';
    act(() => {
      a = api.success('Watch saved');
    });
    advance(500);
    act(() => {
      b = api.success('Watch saved');
    });
    expect(b).toBe(a);
    expect(screen.getAllByText('Watch saved')).toHaveLength(1);
    advance(600);
    act(() => {
      c = api.success('Watch saved');
    });
    expect(c).not.toBe(a);
    expect(screen.getAllByText('Watch saved')).toHaveLength(2);
  });

  it('keeps only the last second of messages for deduplication', () => {
    const store = new ToastStore();
    // Private, read for this test only: the map must not grow with every message ever shown.
    const recent = () => store['recent'];
    for (let i = 0; i < 50; i++) store.add('info', `Message ${i}`);
    expect(recent().size).toBe(50);
    jest.advanceTimersByTime(TOAST_DEDUPE_MS);
    store.add('info', 'One more');
    expect(Array.from(recent().keys())).toEqual(['info|One more']);
  });

  it('removes a queued toast silently when it is dismissed before it shows', () => {
    renderToasts();
    let first = '';
    act(() => {
      first = api.error('One');
      api.error('Two');
      api.error('Three');
      api.dismiss(api.info('Never shown'));
    });
    act(() => {
      api.dismiss(first);
    });
    expect(within(region()).getAllByRole('alert')).toHaveLength(2);
    expect(screen.queryByText('Never shown')).not.toBeInTheDocument();
  });

  it('runs an action and closes', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onUndo = jest.fn();
    renderToasts();
    act(() => {
      api.info('Watch deleted', { action: { label: 'Undo', onClick: onUndo } });
    });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Watch deleted')).not.toBeInTheDocument();
  });

  it('honours a custom duration', () => {
    renderToasts();
    act(() => {
      api.success('Quick one', { duration: 1000 });
    });
    advance(1100);
    expect(screen.queryByText('Quick one')).not.toBeInTheDocument();
  });

  it('stays audible and clickable while a modal is open, mounted outside #root as the app does', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onUndo = jest.fn();
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    function DeleteFlow() {
      const toast = useToast();
      return (
        <ConfirmDialog
          open
          title="Delete this watch?"
          message="This cannot be undone."
          confirmLabel="Delete"
          onCancel={() => undefined}
          // The toast fires while the dialog is still open, as the Watches page does.
          onConfirm={() => {
            toast.info('Watch deleted', { action: { label: 'Undo', onClick: onUndo } });
          }}
        />
      );
    }

    render(
      <ToastProvider>
        <DeleteFlow />
        <Portal>
          <ToastViewport />
        </Portal>
      </ToastProvider>,
      { container: root }
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(root).toHaveAttribute('inert');
    expect(screen.getByRole('alertdialog', { name: 'Delete this watch?' })).toBeInTheDocument();
    const toast = within(liveList()).getByRole('status');
    expect(toast).toHaveTextContent('Watch deleted');
    expect(toast.closest('[inert]')).toBeNull();
    expect(root).not.toContainElement(toast);

    const undo = within(toast).getByRole('button', { name: 'Undo' });
    expect(undo.closest('[inert]')).toBeNull();
    await user.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Watch deleted')).not.toBeInTheDocument();
    root.remove();
  });

  it('throws a clear error outside the provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Capture />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
