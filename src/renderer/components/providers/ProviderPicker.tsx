import { useEffect } from 'react';
import { useProvidersWith, type ProviderCapability } from '../../api/providers';
import {
  Button,
  Notice,
  ProviderBadge,
  RadioCard,
  RadioCardGroup,
  Skeleton,
  VisuallyHidden,
} from '../ui';

export interface ProviderPickerProps {
  /**
   * Only providers offering this are listed (a create flow's provider step, §8). Omit it to
   * list every provider, for a flow that needs no capability (adding a booking by hand).
   */
  capability?: ProviderCapability;
  /** The group's visible label, e.g. "Provider". */
  label: string;
  value: string | undefined;
  onChange: (providerId: string) => void;
  /** Shown when no provider offers the capability, e.g. "No provider supports watches yet". */
  emptyMessage: string;
  hint?: string;
}

/**
 * The provider step of a create flow: one card per provider with `capability`, with its name,
 * description and badge. A single qualifying provider is chosen for you, but still shown
 * (§12.9). Domain-generic: U2 and U3 use it with their own capability (or none).
 */
export function ProviderPicker({
  capability,
  label,
  value,
  onChange,
  emptyMessage,
  hint,
}: ProviderPickerProps) {
  const providers = useProvidersWith(capability);
  const list = providers.data;
  const only = list?.length === 1 ? list[0].id : undefined;

  useEffect(() => {
    if (only && !value) onChange(only);
  }, [only, value, onChange]);

  if (providers.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <p role="status">
          <VisuallyHidden>Loading providers</VisuallyHidden>
        </p>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (providers.isError) {
    return (
      <Notice
        tone="danger"
        title="Providers couldn't be loaded"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void providers.refetch()}>
            Try again
          </Button>
        }
      >
        {providers.error.message}
      </Notice>
    );
  }
  if (!list?.length) return <Notice tone="info">{emptyMessage}</Notice>;

  return (
    <RadioCardGroup label={label} hint={hint} value={value ?? ''} onValueChange={onChange}>
      {list.map((provider) => (
        <RadioCard
          key={provider.id}
          value={provider.id}
          title={provider.name}
          description={provider.description}
          trailing={<ProviderBadge providerId={provider.id} info={provider} variant="compact" />}
        />
      ))}
    </RadioCardGroup>
  );
}

export default ProviderPicker;
