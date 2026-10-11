import { screen } from '@testing-library/react';
import { fail } from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { Button, Notice } from '../../../components/ui';
import { AboutPanel } from './AboutPanel';

describe('AboutPanel', () => {
  it('takes extra actions in its links row and extra content under it (Settings → About)', async () => {
    renderWithProviders(
      <AboutPanel align="start" actions={<Button size="sm">Check for updates</Button>}>
        <Notice tone="success">{"You're up to date"}</Notice>
      </AboutPanel>
    );
    expect(await screen.findByText('Version 2.0.0-test')).toBeVisible();
    const logs = screen.getByRole('button', { name: 'Open logs folder' });
    const check = screen.getByRole('button', { name: 'Check for updates' });
    // Same row, after the panel's own actions
    expect(check.parentElement).toBe(logs.parentElement);
    expect(logs.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent("You're up to date");
    expect(check.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No heading of its own: each host names it
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('still offers its links when the app details cannot be read', async () => {
    renderWithProviders(<AboutPanel />, {
      api: { app: { getInfo: jest.fn().mockResolvedValue(fail('Main is busy', 'NOT_FOUND')) } },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Main is busy');
    // The version reads Unknown; the rest still renders (U4 edge case)
    expect(screen.getByText('Version Unknown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GitHub (opens in your browser)' })).toHaveAttribute(
      'href',
      'https://github.com/wilsonwaters/wa-stay'
    );
  });

  it('keeps the runtime versions in a "Technical details" disclosure, closed at first', async () => {
    const { user } = renderWithProviders(<AboutPanel />);
    const details = await screen.findByRole('button', { name: 'Technical details' });

    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Electron')).not.toBeVisible();

    await user.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Electron')).toBeVisible();
  });
});
