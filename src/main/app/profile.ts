/**
 * The single local profile (architecture-notes §12.21–22).
 *
 * WA Stay keeps one local profile: the first `users` row, id 1 on a fresh install. Every
 * watch, snipe, booking and notification belongs to it, so the renderer never sends a
 * `userId`; main resolves it here. Nothing may delete the row: `ON DELETE CASCADE` would
 * wipe all of the user's data. Signing out clears credential fields only.
 */

import { UserRepository } from '../database/repositories/user.repository';
import { AppError } from '../utils/app-error';

export interface LocalProfile {
  /** Creates the local profile row when the `users` table is empty. Returns its id. Run at startup. */
  ensureLocalProfile(): number;
  /** The local profile's `users.id`. Throws `AppError('NO_PROFILE')` when there is no row. */
  requireUserId(): number;
}

export function createLocalProfile(users: UserRepository): LocalProfile {
  return {
    ensureLocalProfile: () => users.createLocalProfileIfMissing().id,
    requireUserId: () => {
      const profile = users.getFirstUser();
      if (!profile) throw new AppError('NO_PROFILE');
      return profile.id;
    },
  };
}
