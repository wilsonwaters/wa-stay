import { useNavigate } from 'react-router';
import { isAppLinkPath } from '../../../shared/utils/app-links';
import { useApiEvent } from '../../api';

/**
 * Follows `app:navigate`, which main sends when a desktop notification is clicked (after it
 * has brought the window forward). Only the allowed in-app pages are followed; main checks the
 * same list before it sends one.
 */
export function useAppNavigate(): void {
  const navigate = useNavigate();
  useApiEvent('app:navigate', ({ path }) => {
    if (isAppLinkPath(path)) navigate(path);
  });
}
