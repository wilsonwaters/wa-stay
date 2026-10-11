import { useEffect, useRef } from 'react';
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock,
  Hourglass,
  type LucideIcon,
} from 'lucide-react';
import type { AccessStatus } from '../../../shared/types/provider.types';
import { useAccessStatus, useProvidersWith, type ProviderManifest } from '../../api';
import { Countdown } from '../../components/Countdown';
import { timeInZone } from '../../components/timeFormat';
import { Card, IconButton, useAnnounce, useDisclosure } from '../../components/ui';
import { cx } from '../../components/ui/cx';
import {
  accessAnnouncement,
  accessStatusText,
  isAccessChipShown,
  type AnnouncedAccess,
} from './accessStatus';

type Provider = Pick<ProviderManifest, 'id' | 'shortName' | 'timezone'>;

const LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  waiting: { icon: Hourglass, tone: 'text-warning-fg' },
  active: { icon: CircleCheck, tone: 'text-available-fg' },
  expired: { icon: Clock, tone: 'text-fg-secondary' },
  unavailable: { icon: CircleAlert, tone: 'text-danger' },
};

function lookOf(state: AccessStatus['state']) {
  return LOOK[state] ?? LOOK.unavailable;
}

/** What the expanded chip says about the state, in the provider's time zone. */
function details(status: AccessStatus, provider: Provider): string {
  const name = provider.shortName;
  switch (status.state) {
    case 'waiting':
      return `WA Stay is waiting in ${name}'s queue. This updates by itself.`;
    case 'active':
      return status.expiresAt
        ? `WA Stay can use ${name} until ${timeInZone(new Date(status.expiresAt), provider.timezone)}.`
        : `WA Stay can use ${name} now.`;
    case 'expired':
      return `${name}'s queue session ended. WA Stay queues again when it next needs ${name}.`;
    default:
      return `WA Stay couldn't read ${name}'s queue. It tries again when it next needs ${name}.`;
  }
}

export interface AccessStatusChipProps {
  status: AccessStatus;
  provider: Provider;
}

/**
 * One provider's access gate in the tray: a one-line chip ("ParkStay queue · position 123 ·
 * about 4 min", "ParkStay · access granted · 12 min left") that expands to say more. It is not
 * a live region: changes are announced by `ProviderAccessChip`.
 */
export function AccessStatusChip({ status, provider }: AccessStatusChipProps) {
  const { open, buttonProps, panelProps } = useDisclosure();
  const { icon: Icon, tone } = lookOf(status.state);
  return (
    <Card
      as="section"
      aria-label={`${provider.shortName} queue`}
      padding="none"
      elevation="floating"
      className="pointer-events-auto"
    >
      <div className="flex items-center gap-2 py-1 pl-3 pr-1">
        <Icon size={16} aria-hidden="true" className={cx('shrink-0', tone)} />
        <p className="min-w-0 flex-1 text-sm font-semibold text-fg">
          {accessStatusText(status, provider.shortName)}
          {status.state === 'active' && status.expiresAt && (
            <>
              {' · '}
              <Countdown to={status.expiresAt} format="minutes" /> left
            </>
          )}
        </p>
        <IconButton
          {...buttonProps}
          size="sm"
          label={`${provider.shortName} queue details`}
          icon={
            <ChevronDown
              size={16}
              className={cx(
                'transition-transform duration-base ease-standard',
                open && 'rotate-180'
              )}
            />
          }
        />
      </div>
      <div {...panelProps} className="border-t border-border px-3 py-2 text-sm text-fg-secondary">
        <p>{details(status, provider)}</p>
        {status.message && <p className="mt-1">{status.message}</p>}
        <p className="mt-1 text-xs text-fg-muted">
          Updated {timeInZone(new Date(status.updatedAt), provider.timezone)}
        </p>
      </div>
    </Card>
  );
}

/**
 * A provider's gate, kept current from `provider:access-status` (no polling), with its changes
 * announced through the app's one polite live region: a new state at once, a new position
 * while waiting at most once a minute. Idle shows nothing.
 */
export function ProviderAccessChip({ provider }: { provider: Provider }) {
  const { data: status } = useAccessStatus(provider.id);
  const announce = useAnnounce();
  const last = useRef<AnnouncedAccess | null>(null);

  useEffect(() => {
    if (!status) return;
    const now = Date.now();
    const message = accessAnnouncement(last.current, status, provider.shortName, now);
    if (message) announce(message);
    last.current = {
      state: status.state,
      position: status.position,
      announcedAt: message ? now : (last.current?.announcedAt ?? null),
    };
  }, [status, provider.shortName, announce]);

  return isAccessChipShown(status) ? (
    <AccessStatusChip status={status} provider={provider} />
  ) : null;
}

/** One chip per provider with an access gate whose status is not idle. */
export function AccessStatusChips() {
  const { data: providers = [] } = useProvidersWith('accessGate');
  return (
    <>
      {providers.map((provider) => (
        <ProviderAccessChip key={provider.id} provider={provider} />
      ))}
    </>
  );
}

export default AccessStatusChips;
