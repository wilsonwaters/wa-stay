import { screen, waitFor, within } from '@testing-library/react';
import {
  TYPED_PASSWORD,
  form,
  openForm,
  setupEmail as setup,
} from '@tests/fixtures/renderer/settings-email';
import { politeAnnouncement } from '@tests/fixtures/renderer/settings';

describe('EmailNotifierCard: test email and on/off', () => {
  it('"Send test email" calls the notifier test and reads the result out politely', async () => {
    const { user, notifiers } = setup();
    await screen.findByText('On');

    await user.click(screen.getByRole('button', { name: 'Send test email' }));

    expect(notifiers.test).toHaveBeenCalledWith('email_smtp');
    const status = await screen.findByText('Test email sent to ann@example.com. Check your inbox.');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('with unsaved changes the button reads "Save and send test": it saves, then tests', async () => {
    const { user, notifiers } = setup();
    const settings = await openForm(user);
    expect(within(settings).getByRole('button', { name: 'Send test email' })).toBeInTheDocument();

    await user.type(within(settings).getByRole('textbox', { name: /Send alerts to/ }), 'me@x.au');
    await user.click(within(settings).getByRole('button', { name: 'Save and send test' }));

    await waitFor(() => expect(notifiers.test).toHaveBeenCalledTimes(1));
    expect(notifiers.configure).toHaveBeenCalledTimes(1);
    expect(notifiers.configure.mock.invocationCallOrder[0]).toBeLessThan(
      notifiers.test.mock.invocationCallOrder[0]
    );
    expect(
      await screen.findByText('Test email sent to me@x.au. Check your inbox.')
    ).toBeInTheDocument();
  });

  it('a failed test says what went wrong in plain words, and the status shows the error', async () => {
    const { user, fail } = setup();
    await screen.findByText('On');
    fail('Invalid login: 535-5.7.8 Username and Password not accepted');

    await user.click(screen.getByRole('button', { name: 'Send test email' }));

    expect(
      await screen.findByText(
        "The mail server didn't accept the account or password. The full error is in the log files (About, Open logs folder)."
      )
    ).toBeInTheDocument();
    // The status line too, never the raw reply
    expect(
      await screen.findByText("The mail server didn't accept the account or password.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/535/)).toBeNull();
  });

  it('a server that refuses the connection reads "Couldn\'t reach the mail server at host:port"', async () => {
    const { user, fail } = setup();
    await screen.findByText('On');
    fail('connect ECONNREFUSED 74.125.0.1:587');

    await user.click(screen.getByRole('button', { name: 'Send test email' }));

    expect(
      await screen.findByText("Couldn't reach the mail server at smtp.gmail.com:587.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();
  });

  it('"Edit settings" and "Send test email" sit on one row', async () => {
    setup();
    const edit = await screen.findByRole('button', { name: 'Edit settings' });
    const test = screen.getByRole('button', { name: 'Send test email' });
    expect(edit.parentElement).toBe(test.parentElement);
  });

  it('the switch turns email off and on (enable/disable), announcing it', async () => {
    const { user, notifiers } = setup();
    const toggle = await screen.findByRole('switch', { name: 'Email notifications' });
    await waitFor(() => expect(toggle).toBeChecked());

    await user.click(toggle);

    expect(notifiers.disable).toHaveBeenCalledWith('email_smtp');
    await waitFor(() => expect(politeAnnouncement()).toBe('Email notifications off'));
    expect(await screen.findByText('Off')).toBeInTheDocument();
  });
});

describe('EmailNotifierCard before it is set up', () => {
  it('turning it on opens the form without calling enable; saving sends enabled and the password', async () => {
    const { user, notifiers } = setup(null);
    expect(await screen.findByText('Not set up')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Email notifications' }));

    expect(notifiers.enable).not.toHaveBeenCalled();
    const settings = form();
    await user.type(
      within(settings).getByRole('textbox', { name: 'Email address' }),
      'ann@example.com'
    );
    await user.type(within(settings).getByLabelText('App password'), TYPED_PASSWORD);
    await user.click(within(settings).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(notifiers.configure).toHaveBeenCalledTimes(1));
    expect(notifiers.configure.mock.calls[0][0]).toMatchObject({
      enabled: true,
      config: { auth: { user: 'ann@example.com', pass: TYPED_PASSWORD } },
    });
    expect(await screen.findByText('On')).toBeInTheDocument();
  });

  it('a custom server: the port must be 1–65535 (linked to the field), and 465 with STARTTLS gets a hint', async () => {
    const { user, notifiers } = setup(null);
    await user.click(await screen.findByRole('button', { name: 'Set up email' }));
    const settings = form();

    await user.click(within(settings).getByRole('radio', { name: 'Other mail server' }));
    const port = within(settings).getByRole('textbox', { name: 'Port' });
    await user.clear(port);
    await user.type(port, '70000');
    await user.type(within(settings).getByRole('textbox', { name: 'User name' }), 'ann');
    await user.type(within(settings).getByLabelText('Password'), 'secret');
    await user.click(within(settings).getByRole('button', { name: 'Save' }));

    expect(await within(settings).findByText('Enter a port from 1 to 65535')).toBeInTheDocument();
    expect(port).toHaveAccessibleDescription('Enter a port from 1 to 65535');
    expect(port).toHaveAttribute('aria-invalid', 'true');
    expect(notifiers.configure).not.toHaveBeenCalled();

    await user.clear(port);
    await user.type(port, '465');
    expect(
      within(settings).getByRole('combobox', { name: 'Security' })
    ).toHaveAccessibleDescription('Port 465 usually uses SSL/TLS.');
  });
});
