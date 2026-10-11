import { screen, waitFor, within } from '@testing-library/react';
import {
  TYPED_PASSWORD,
  form,
  openForm,
  setupEmail as setup,
} from '@tests/fixtures/renderer/settings-email';
import { emailNotifier, politeAnnouncement } from '@tests/fixtures/renderer/settings';
import { NotifierStatus, SMTPPreset } from '../../../../../shared/types/notifier.types';

describe('EmailNotifierCard with a stored password (hasPassword)', () => {
  it('shows the status and a one-line summary, never a password', async () => {
    setup(emailNotifier({ lastTestedAt: new Date(2026, 9, 3, 12) }));

    expect(await screen.findByText('On')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Sends to ann@example.com through smtp.gmail.com · last tested Sat 3 Oct 2026'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Email notifications' })).toBeChecked();
  });

  it('renders no password input; "Password saved" and Replace are shown', async () => {
    const { user } = setup();
    const settings = await openForm(user);

    expect(within(settings).getByText('Password saved')).toBeInTheDocument();
    expect(within(settings).getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(settings.querySelector('input[type="password"]')).toBeNull();
    expect(within(settings).queryByLabelText(/password/i)).toBeNull();
    expect(
      within(settings).getByText(
        'Stored encrypted on this device and sent only to your mail server.'
      )
    ).toBeInTheDocument();
  });

  it('Save without Replace sends no password, succeeds, and returns focus to Edit settings', async () => {
    const { user, notifiers } = setup();
    const settings = await openForm(user);
    await user.type(within(settings).getByRole('textbox', { name: /Send alerts to/ }), 'me@x.au');

    await user.click(within(settings).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(notifiers.configure).toHaveBeenCalledTimes(1));
    const sent = notifiers.configure.mock.calls[0][0];
    expect(sent).toMatchObject({
      enabled: true,
      config: { auth: { user: 'ann@example.com' }, toEmail: 'me@x.au' },
    });
    expect(sent.config.auth).not.toHaveProperty('pass');
    const edit = await screen.findByRole('button', { name: 'Edit settings' });
    await waitFor(() => expect(edit).toHaveFocus());
    expect(politeAnnouncement()).toBe('Email settings saved');
  });

  it('Replace moves focus into the new password field; Cancel restores "Password saved" and focuses Replace', async () => {
    const { user } = setup();
    const settings = await openForm(user);

    await user.click(within(settings).getByRole('button', { name: 'Replace' }));
    const field = within(settings).getByLabelText('New app password');
    expect(field).toHaveAttribute('type', 'password');
    await waitFor(() => expect(field).toHaveFocus());

    await user.click(
      within(settings).getByRole('button', { name: 'Cancel replacing the password' })
    );
    expect(within(settings).getByText('Password saved')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(settings).getByRole('button', { name: 'Replace' })).toHaveFocus()
    );
  });

  it('a replaced password is sent once, and no query or mutation cache keeps it', async () => {
    const { user, notifiers, queryClient } = setup();
    const settings = await openForm(user);
    await user.click(within(settings).getByRole('button', { name: 'Replace' }));
    await user.type(within(settings).getByLabelText('New app password'), TYPED_PASSWORD);

    await user.click(within(settings).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(notifiers.configure).toHaveBeenCalledTimes(1));
    expect(notifiers.configure.mock.calls[0][0].config.auth).toEqual({
      user: 'ann@example.com',
      pass: TYPED_PASSWORD,
    });
    await screen.findByRole('button', { name: 'Edit settings' });
    const cached = JSON.stringify([
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
      queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state.variables),
    ]);
    expect(cached).not.toContain(TYPED_PASSWORD);
  });

  it('changing the account asks for its password, as main would', async () => {
    const { user, notifiers } = setup();
    const settings = await openForm(user);
    const address = within(settings).getByRole('textbox', { name: 'Email address' });

    await user.clear(address);
    await user.type(address, 'bob@example.com');

    const field = within(settings).getByLabelText('App password');
    expect(field).toHaveAccessibleDescription(
      'Enter the password for this server and account. Stored encrypted on this device and sent only to your mail server.'
    );
    await user.click(within(settings).getByRole('button', { name: 'Save' }));
    expect(await within(settings).findByText('Enter the password')).toBeInTheDocument();
    expect(notifiers.configure).not.toHaveBeenCalled();
  });

  it('an unreadable stored password asks to be entered again', async () => {
    const { user } = setup(
      emailNotifier({
        secretState: 'unreadable',
        status: NotifierStatus.ERROR,
        lastError: 'Saved password could not be decrypted; re-enter it',
      })
    );
    expect(
      await screen.findByText(
        "The saved password couldn't be read on this computer. Enter it again."
      )
    ).toBeInTheDocument();
    const settings = await openForm(user);

    expect(within(settings).getByLabelText('App password')).toHaveAccessibleDescription(
      /couldn't be read on this computer\. Enter it again\./
    );
  });
});

describe('EmailNotifierCard focus when the form opens', () => {
  it('"Set up email" moves focus to the form’s first field, the mail service', async () => {
    const { user } = setup(null);
    await user.click(await screen.findByRole('button', { name: 'Set up email' }));

    const settings = form();
    const service = within(settings).getByRole('group', { name: 'Mail service' });
    await waitFor(() =>
      expect(within(service).getByRole('radio', { name: 'Gmail' })).toHaveFocus()
    );
  });

  it('"Edit settings" moves focus to the stored service’s radio', async () => {
    const { user } = setup(
      emailNotifier({
        config: {
          ...emailNotifier().config,
          preset: SMTPPreset.OUTLOOK,
          host: 'smtp-mail.outlook.com',
        },
      })
    );
    const settings = await openForm(user);

    await waitFor(() =>
      expect(within(settings).getByRole('radio', { name: 'Outlook' })).toHaveFocus()
    );
  });

  it('turning the switch on before setting up opens the form and leaves focus on the switch', async () => {
    const { user } = setup(null);
    const toggle = await screen.findByRole('switch', { name: 'Email notifications' });
    await user.click(toggle);

    expect(form()).toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });
});
