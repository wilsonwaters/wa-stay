/**
 * A provider's notice (§12.37): the dialog shows the manifest's notice as text, Continue waits
 * for the tick, Not now asks nothing, Continue accepts the version shown, and a refusal shows
 * main's words. `useNoticeGate` asks only for a provider with a notice.
 */
import { screen, waitFor, within } from '@testing-library/react';
import {
  fail,
  ok,
  PARKSTAY_MANIFEST,
  ROTTNEST_MANIFEST,
} from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { ProviderNoticeDialog, useNoticeGate } from './ProviderNoticeDialog';
import type { ProviderManifest } from '../../../shared/types/provider.types';

const NOTICE = ROTTNEST_MANIFEST.notice!;
const ACCEPTED = {
  providerId: 'rottnest',
  required: true,
  accepted: true,
  version: NOTICE.version,
  acceptedAt: '2026-10-18T02:00:00.000Z',
};
const NOT_ACCEPTED = { providerId: 'rottnest', required: true, accepted: false, version: 1 };

function renderDialog(acceptNotice = jest.fn().mockResolvedValue(ok(ACCEPTED))) {
  const onAccepted = jest.fn();
  const onClose = jest.fn();
  const view = renderWithProviders(
    <ProviderNoticeDialog manifest={ROTTNEST_MANIFEST} onAccepted={onAccepted} onClose={onClose} />,
    {
      api: {
        providers: { list: jest.fn().mockResolvedValue(ok([ROTTNEST_MANIFEST])), acceptNotice },
      },
    }
  );
  const dialog = screen.getByRole('dialog', { name: NOTICE.title });
  return { ...view, dialog, onAccepted, onClose, acceptNotice };
}

describe('ProviderNoticeDialog', () => {
  it("shows the notice's paragraphs and points as text, and its checkbox", () => {
    const { dialog } = renderDialog();
    for (const paragraph of NOTICE.body.split('\n\n')) {
      expect(within(dialog).getByText(paragraph)).toBeVisible();
    }
    const points = within(dialog).getAllByRole('listitem');
    expect(points.map((point) => point.textContent)).toEqual(NOTICE.points);
    expect(within(dialog).getByRole('checkbox', { name: NOTICE.confirmLabel })).not.toBeChecked();
  });

  it('Continue waits for the tick, and says so', async () => {
    const { user, dialog, acceptNotice } = renderDialog();
    const go = within(dialog).getByRole('button', { name: 'Continue' });
    expect(go).toBeDisabled();
    expect(go).toHaveAccessibleDescription('Tick the box to continue.');

    await user.click(within(dialog).getByRole('checkbox', { name: NOTICE.confirmLabel }));
    expect(go).toBeEnabled();
    expect(within(dialog).queryByText('Tick the box to continue.')).not.toBeInTheDocument();
    expect(acceptNotice).not.toHaveBeenCalled();
  });

  it('Not now closes it and accepts nothing', async () => {
    const { user, dialog, onClose, onAccepted, acceptNotice } = renderDialog();
    await user.click(within(dialog).getByRole('checkbox', { name: NOTICE.confirmLabel }));
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAccepted).not.toHaveBeenCalled();
    expect(acceptNotice).not.toHaveBeenCalled();
  });

  it('Continue accepts the version shown, and hands on main’s answer', async () => {
    const { user, dialog, onAccepted, acceptNotice } = renderDialog();
    await user.click(within(dialog).getByRole('checkbox', { name: NOTICE.confirmLabel }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(ACCEPTED));
    expect(acceptNotice).toHaveBeenCalledWith('rottnest', NOTICE.version);
  });

  it("a refusal (the notice changed meanwhile) shows main's words and keeps the dialog", async () => {
    const refusal = "Stay Rottnest's notice has changed. Read it again.";
    const { user, dialog, onAccepted } = renderDialog(
      jest.fn().mockResolvedValue(fail(refusal, 'VALIDATION'))
    );
    await user.click(within(dialog).getByRole('checkbox', { name: NOTICE.confirmLabel }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(await within(dialog).findByText(refusal)).toBeVisible();
    expect(onAccepted).not.toHaveBeenCalled();
  });
});

function Gate({ manifest, then }: { manifest: ProviderManifest; then: () => void }) {
  const gate = useNoticeGate(manifest);
  return (
    <>
      <p>{gate.needed ? 'Notice needed' : 'No notice needed'}</p>
      <button type="button" onClick={() => (gate.needed ? gate.ask(then) : then())}>
        Check
      </button>
      {gate.dialog}
    </>
  );
}

describe('useNoticeGate', () => {
  it('asks nothing for a provider without a notice, and lets the check run', async () => {
    const then = jest.fn();
    const notice = jest.fn();
    const { user } = renderWithProviders(<Gate manifest={PARKSTAY_MANIFEST} then={then} />, {
      api: { providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST])), notice } },
    });
    expect(screen.getByText('No notice needed')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(then).toHaveBeenCalledTimes(1);
    expect(notice).not.toHaveBeenCalled();
  });

  it('opens the notice while it is not accepted, and runs the check once it is', async () => {
    const then = jest.fn();
    const notice = jest.fn().mockResolvedValue(ok(NOT_ACCEPTED));
    const { user } = renderWithProviders(<Gate manifest={ROTTNEST_MANIFEST} then={then} />, {
      api: {
        providers: {
          list: jest.fn().mockResolvedValue(ok([ROTTNEST_MANIFEST])),
          notice,
          acceptNotice: jest.fn().mockResolvedValue(ok(ACCEPTED)),
        },
      },
    });
    await waitFor(() => expect(notice).toHaveBeenCalledWith('rottnest'));
    expect(screen.getByText('Notice needed')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Check' }));
    const dialog = screen.getByRole('dialog', { name: NOTICE.title });
    expect(then).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('checkbox', { name: NOTICE.confirmLabel }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(then).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('No notice needed')).toBeVisible();
  });
});
