/**
 * Settings → Notifications set up for the email notifier tests (U4): `notifiers.*` keeps the
 * notifier as main does, and never sends a password back.
 */
import { screen } from '@testing-library/react';
import type { EmailNotifierView } from '../../../src/renderer/api';
import { NotifierStatus } from '../../../src/shared/types/notifier.types';
import { createMockApi, ok } from '../../utils/renderer/createMockApi';
import { renderWithApp } from '../../utils/renderer/renderWithApp';
import { PARKSTAY, emailNotifier } from './settings';

export const TYPED_PASSWORD = 'abcd efgh ijkl mnop';

/** The email notifier behind `notifiers.*`, as main keeps it: the password never comes back. */
export function setupEmail(initial: EmailNotifierView | null = emailNotifier()) {
  let stored = initial;
  const notifiers = {
    get: jest.fn(() => Promise.resolve(ok(stored))),
    configure: jest.fn(
      (input: { enabled?: boolean; config: { auth: { user: string; pass?: string } } }) => {
        const { pass, ...auth } = input.config.auth;
        stored = {
          ...(stored ?? emailNotifier()),
          enabled: input.enabled ?? false,
          config: { ...input.config, auth } as EmailNotifierView['config'],
          hasPassword: Boolean(pass) || Boolean(stored?.hasPassword),
          status: NotifierStatus.CONFIGURED,
        };
        return Promise.resolve(ok(stored));
      }
    ),
    enable: jest.fn(() => {
      stored = stored && { ...stored, enabled: true };
      return Promise.resolve(ok(true));
    }),
    disable: jest.fn(() => {
      stored = stored && { ...stored, enabled: false };
      return Promise.resolve(ok(true));
    }),
    test: jest.fn(() => Promise.resolve(ok({ success: true, message: 'Test email sent' }))),
  };
  const mock = createMockApi({
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY])) },
    settings: { get: jest.fn().mockResolvedValue(ok(true)) },
    notifiers,
  });
  const rendered = renderWithApp({ route: '/settings/notifications', api: mock });
  return {
    ...rendered,
    notifiers,
    fail: (error: string) => {
      notifiers.test.mockImplementationOnce(() => {
        stored = stored && { ...stored, status: NotifierStatus.ERROR, lastError: error };
        return Promise.resolve(ok({ success: false, message: 'Connection failed', error }));
      });
    },
  };
}

export const form = () => screen.getByRole('form', { name: 'Email settings' });

export async function openForm(user: ReturnType<typeof setupEmail>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Edit settings' }));
  return form();
}
