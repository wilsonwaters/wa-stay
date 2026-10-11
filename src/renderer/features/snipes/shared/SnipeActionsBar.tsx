import { Ellipsis, Eye, Play, Trash2 } from 'lucide-react';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { ROUTES } from '../../../app/routes';
import { bookingHref } from './snipeFormat';
import { Button, IconButton, Menu, MenuItem, MenuSeparator } from '../../../components/ui';
import { isRunning, primaryActionFor } from './snipeState';
import type { SnipeActions } from './useSnipeActions';

export interface SnipeActionsBarProps {
  snipe: SiteSnipe;
  /** Undefined when the snipe's provider is not installed: only Delete stays enabled. */
  manifest: ProviderManifest | undefined;
  actions: SnipeActions;
  /** Opens the delete ConfirmDialog. */
  onDelete: () => void;
  /** The detail page: Arm is its coral button and the menu has no "View details". */
  onPage?: boolean;
}

/**
 * One visible action by status (Arm, Arm again, Disarm, View booking; a held site's "Pay now"
 * is in its hold panel), and a "More actions for {name}" menu with View details, Run now and
 * Delete (Run now only while it runs). A held or booked snipe is never offered Arm: main
 * refuses it (§12.31).
 */
export function SnipeActionsBar({
  snipe,
  manifest,
  actions,
  onDelete,
  onPage = false,
}: SnipeActionsBarProps) {
  const known = manifest !== undefined;
  const action = primaryActionFor(snipe);
  // One attempt now only while it runs: main answers "not active" for a stopped snipe.
  const canRun = known && isRunning(snipe);
  const size = onPage ? 'md' : 'sm';

  return (
    <div className="flex items-center gap-2">
      {(action === 'arm' || action === 'arm-again') && (
        <Button
          variant={onPage ? 'primary' : 'secondary'}
          size={size}
          onClick={actions.arm}
          loading={actions.arming}
          disabled={!known}
        >
          {action === 'arm' ? 'Arm' : 'Arm again'}
        </Button>
      )}
      {action === 'disarm' && (
        <Button
          variant="secondary"
          size={size}
          onClick={actions.disarm}
          loading={actions.disarming}
          disabled={!known}
        >
          Disarm
        </Button>
      )}
      {action === 'booking' && (
        <Button
          as="a"
          href={`#${bookingHref(snipe.bookedReference)}`}
          variant="secondary"
          size={size}
        >
          View booking
        </Button>
      )}
      <Menu
        align="end"
        trigger={
          <IconButton
            label={`More actions for ${snipe.name}`}
            icon={<Ellipsis />}
            variant="ghost"
            size={size}
          />
        }
      >
        {!onPage && (
          <MenuItem icon={<Eye size={16} />} href={`#${ROUTES.snipeDetail(snipe.id)}`}>
            View details
          </MenuItem>
        )}
        {canRun && (
          <MenuItem icon={<Play size={16} />} onSelect={actions.runNow} disabled={actions.running}>
            Run now
          </MenuItem>
        )}
        {(!onPage || canRun) && <MenuSeparator />}
        <MenuItem icon={<Trash2 size={16} />} tone="danger" onSelect={onDelete}>
          Delete
        </MenuItem>
      </Menu>
    </div>
  );
}

export default SnipeActionsBar;
