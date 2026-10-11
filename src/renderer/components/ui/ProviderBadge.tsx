import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import { CircleQuestionMark } from 'lucide-react';
import { readableTextOn } from './brandContrast';
import { cx } from './cx';

/**
 * What a badge needs to know about a provider. Structurally a subset of `ProviderManifest`
 * (architecture-notes §3), so a manifest can be passed as is; ui/ never imports main code.
 */
export interface ProviderBadgeInfo {
  id: string;
  name: string;
  shortName: string;
  brand: { color: string; monogram: string };
}

interface ProviderLookup {
  get: (id: string) => ProviderBadgeInfo | undefined;
}

/** Filled by the app shell from `providers.list()` (D3), so badges need only an id. */
export const ProviderManifestsContext = createContext<ProviderLookup | null>(null);

export function ProviderManifestsProvider({
  manifests,
  children,
}: {
  manifests: readonly ProviderBadgeInfo[];
  children: ReactNode;
}) {
  const lookup = useMemo<ProviderLookup>(() => {
    const byId = new Map(manifests.map((m) => [m.id, m]));
    return { get: (id) => byId.get(id) };
  }, [manifests]);
  return (
    <ProviderManifestsContext.Provider value={lookup}>{children}</ProviderManifestsContext.Provider>
  );
}

export interface ProviderBadgeProps {
  providerId: string;
  /** The provider's details. Omit to look them up in ProviderManifestsContext. */
  info?: ProviderBadgeInfo;
  /** `full` shows monogram and short name; `compact` only the monogram. */
  variant?: 'full' | 'compact';
  size?: 'sm' | 'md';
  className?: string;
}

const MONOGRAM_SIZE = {
  sm: 'h-5 min-w-5 px-1 text-[0.625rem]',
  md: 'h-6 min-w-6 px-1.5 text-xs',
};

/**
 * Whose system a watch, snipe, booking, notification or location belongs to: a coloured
 * monogram (never a third-party logo) and the short name. Its accessible name is the
 * provider's name; an unknown provider shows its id and is named "Unknown provider".
 */
export function ProviderBadge({
  providerId,
  info,
  variant = 'full',
  size = 'md',
  className,
}: ProviderBadgeProps) {
  const lookup = useContext(ProviderManifestsContext);
  const provider = info ?? lookup?.get(providerId);
  const text = size === 'sm' ? 'text-xs' : 'text-sm';

  if (!provider) {
    return (
      <span
        role="img"
        aria-label="Unknown provider"
        title={`Unknown provider: ${providerId}`}
        className={cx(
          'inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-border-strong px-1.5 font-medium text-fg-secondary',
          size === 'sm' ? 'h-5 text-xs' : 'h-6 text-sm',
          className
        )}
      >
        <CircleQuestionMark size={size === 'sm' ? 12 : 14} aria-hidden="true" />
        {providerId}
      </span>
    );
  }

  const look = readableTextOn(provider.brand.color);
  const style: CSSProperties =
    look.fill === 'solid'
      ? { backgroundColor: provider.brand.color }
      : { borderColor: provider.brand.color };
  const monogram = (
    <span
      aria-hidden="true"
      style={style}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md font-bold leading-none tracking-wide',
        MONOGRAM_SIZE[size],
        look.fill === 'solid'
          ? look.text === 'fg'
            ? 'text-fg'
            : 'text-fg-inverse'
          : 'border-2 border-border-strong bg-surface text-fg'
      )}
    >
      {provider.brand.monogram}
    </span>
  );

  return (
    <span
      role="img"
      aria-label={provider.name}
      title={variant === 'compact' ? provider.name : undefined}
      className={cx('inline-flex items-center gap-1.5 whitespace-nowrap', className)}
    >
      {monogram}
      {variant === 'full' && (
        <span className={cx('font-semibold text-fg', text)}>{provider.shortName}</span>
      )}
    </span>
  );
}

export default ProviderBadge;
