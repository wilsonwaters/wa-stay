import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotifierConfigureInput } from '../../shared/contracts/notifiers';
import {
  NotifierChannel,
  type NotifierView,
  type SMTPConfigView,
  type TestConnectionResult,
} from '../../shared/types/notifier.types';
import { assertTypeEquals } from '../../shared/utils/type-equality';
import { unwrap } from './client';
import { queryKeys } from './queryKeys';

/**
 * The email notifier as the renderer sees it. Its SMTP password is write-only: the view says
 * only whether one is stored (`hasPassword`), and its `auth` holds the user name alone.
 */
export type EmailNotifierView = Omit<NotifierView, 'config'> & { config: SMTPConfigView };

// No secret reaches the renderer (architecture-notes §4, §7): the types say so, too.
assertTypeEquals<keyof EmailNotifierView['config']['auth'], 'user'>(true);
assertTypeEquals<EmailNotifierView['hasPassword'], boolean>(true);

const EMAIL = NotifierChannel.EMAIL_SMTP;

/** The email notifier, or `null` while it has never been set up. */
export function useEmailNotifier() {
  return useQuery({
    queryKey: queryKeys.notifiers.detail(EMAIL),
    queryFn: async () =>
      (await unwrap((api) => api.notifiers.get(EMAIL))) as EmailNotifierView | null,
  });
}

function useRefreshNotifiers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.notifiers.all });
}

/**
 * Saves the email notifier's settings. Leave `config.auth.pass` out to keep the stored
 * password (main allows that only for the same server and account). The mutation is dropped
 * from React Query's cache as soon as it settles (`gcTime: 0`), and callers `reset()` it, so a
 * typed password is not kept after the save.
 */
export function useConfigureEmailNotifier() {
  const queryClient = useQueryClient();
  const refresh = useRefreshNotifiers();
  return useMutation({
    mutationFn: (input: NotifierConfigureInput) =>
      unwrap((api) => api.notifiers.configure(input)) as Promise<EmailNotifierView>,
    gcTime: 0,
    onSuccess: (view) => queryClient.setQueryData(queryKeys.notifiers.detail(EMAIL), view),
    onSettled: refresh,
  });
}

/** Turns email notifications on or off (the stored settings stay). */
export function useSetEmailNotifierEnabled() {
  const refresh = useRefreshNotifiers();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      unwrap((api) => (enabled ? api.notifiers.enable(EMAIL) : api.notifiers.disable(EMAIL))),
    onSettled: refresh,
  });
}

/** Sends a test email with the stored settings; the notifier's status and last test update. */
export function useTestEmailNotifier() {
  const refresh = useRefreshNotifiers();
  return useMutation({
    mutationFn: (): Promise<TestConnectionResult> => unwrap((api) => api.notifiers.test(EMAIL)),
    onSettled: refresh,
  });
}
