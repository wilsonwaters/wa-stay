import { Ellipsis, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { ROUTES } from '../../../app/routes';
import { Button, IconButton, Menu, MenuItem, MenuSeparator } from '../../../components/ui';
import type { WatchActions } from './useWatchActions';
import type { WatchState } from './watchState';

export interface WatchActionsBarProps {
  watch: Watch;
  state: WatchState;
  /** Undefined when the watch's provider is not installed: only Delete stays enabled. */
  manifest: ProviderManifest | undefined;
  actions: WatchActions;
  /** Opens the delete ConfirmDialog. */
  onDelete: () => void;
}

/**
 * One visible action and a "More actions for {name}" menu, by state (U1 design §3): no
 * rainbow of buttons. A held unit's "Pay now" is in its hold panel, as for a snipe.
 * Pause/Resume, Edit and Delete live in the menu; Resume is never offered once a watch has held
 * or booked a unit, because main refuses it.
 */
export function WatchActionsBar({
  watch,
  state,
  manifest,
  actions,
  onDelete,
}: WatchActionsBarProps) {
  const known = manifest !== undefined;
  const checkable = state === 'active' || state === 'paused';
  const canPause = watch.isActive && (state === 'active' || state === 'held');
  const canResume = state === 'paused';
  const canEdit = state !== 'booked';

  return (
    <div className="flex items-center gap-2">
      {checkable && (
        <Button
          variant="secondary"
          size="sm"
          onClick={actions.checkNow}
          loading={actions.checking}
          disabled={!known}
        >
          Check now
        </Button>
      )}
      <Menu
        align="end"
        trigger={
          <IconButton
            label={`More actions for ${watch.name}`}
            icon={<Ellipsis />}
            variant="ghost"
            size="sm"
          />
        }
      >
        {canPause && (
          <MenuItem icon={<Pause size={16} />} onSelect={actions.pause} disabled={!known}>
            Pause
          </MenuItem>
        )}
        {canResume && (
          <MenuItem icon={<Play size={16} />} onSelect={actions.resume} disabled={!known}>
            Resume
          </MenuItem>
        )}
        {canEdit && (
          <MenuItem
            icon={<Pencil size={16} />}
            href={`#${ROUTES.watchEdit(watch.id)}`}
            disabled={!known}
          >
            Edit
          </MenuItem>
        )}
        {(canPause || canResume || canEdit) && <MenuSeparator />}
        <MenuItem icon={<Trash2 size={16} />} tone="danger" onSelect={onDelete}>
          Delete
        </MenuItem>
      </Menu>
    </div>
  );
}

export default WatchActionsBar;
