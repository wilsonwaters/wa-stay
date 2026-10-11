import { act, fireEvent, screen, within } from '@testing-library/react';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

async function openAbout() {
  const result = renderWithApp();
  const menuButton = screen.getByRole('button', { name: 'Account and settings' });
  await result.user.click(menuButton);
  await result.user.click(screen.getByRole('menuitem', { name: 'About WA Stay' }));
  const dialog = await screen.findByRole('dialog', { name: 'About WA Stay' });
  return { ...result, menuButton, dialog };
}

describe('AboutDialog', () => {
  it('opens from the account menu: WA Stay, the version and the GitHub link', async () => {
    const { dialog } = await openAbout();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
    expect(title).toHaveTextContent('About WA Stay');
    expect(await within(dialog).findByText('Version 2.0.0-test')).toBeVisible();
    expect(
      within(dialog).getByRole('link', { name: 'GitHub (opens in your browser)' })
    ).toHaveAttribute('href', 'https://github.com/wilsonwaters/wa-stay');
    // The B1 lockup, decorative: the title names the dialog.
    expect(dialog.querySelector('img[src$="logo-lockup.svg"]')).toHaveAttribute('alt', '');
  });

  it('traps focus, and Escape returns focus to the account menu button', async () => {
    const { dialog, menuButton, user } = await openAbout();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toHaveFocus();
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'About WA Stay' })).toBeNull();
    expect(menuButton).toHaveFocus();
  });

  it('shows the wordmark, never a broken image, when the logo cannot load', async () => {
    const { dialog } = await openAbout();
    const logo = dialog.querySelector('img') as HTMLImageElement;
    act(() => {
      fireEvent.error(logo);
    });
    expect(dialog.querySelector('img')).toBeNull();
    expect(within(dialog).getByText('WA Stay')).toBeVisible();
  });

  it('opens the logs folder', async () => {
    const { dialog, user, mock } = await openAbout();
    await user.click(within(dialog).getByRole('button', { name: 'Open logs folder' }));
    expect(mock?.api.app.openLogsFolder).toHaveBeenCalledTimes(1);
  });
});
