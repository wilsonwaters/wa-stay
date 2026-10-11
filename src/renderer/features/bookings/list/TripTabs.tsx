import type { ReactNode } from 'react';
import { Tab, TabList, TabPanel, Tabs, VisuallyHidden } from '../../../components/ui';
import { TRIP_TABS, type TripTab } from './tripBuckets';

export interface TripTabsProps {
  value: TripTab;
  onChange: (tab: TripTab) => void;
  counts: Record<TripTab, number>;
  /** The selected tab's content; the other panels stay empty and hidden. */
  children: ReactNode;
}

const tripsLabel = (n: number) => `${n} ${n === 1 ? 'trip' : 'trips'}`;

/**
 * Upcoming · Past · Cancelled, each with a count: the D2 ARIA tabs (tablist/tab/tabpanel,
 * ←/→/Home/End, roving tabindex).
 */
export function TripTabs({ value, onChange, counts, children }: TripTabsProps) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as TripTab)}>
      <TabList aria-label="Trips">
        {TRIP_TABS.map((tab) => (
          <Tab key={tab.value} value={tab.value}>
            {/* The name comes whole from the hidden text, as the nav's "Soon" items do. */}
            <span aria-hidden="true">{tab.label}</span>
            <span
              aria-hidden="true"
              className="min-w-6 rounded-full bg-surface-subtle px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-fg-secondary"
            >
              {counts[tab.value]}
            </span>
            <VisuallyHidden>{`${tab.label}, ${tripsLabel(counts[tab.value])}`}</VisuallyHidden>
          </Tab>
        ))}
      </TabList>
      {TRIP_TABS.map((tab) => (
        <TabPanel key={tab.value} value={tab.value}>
          {tab.value === value ? children : null}
        </TabPanel>
      ))}
    </Tabs>
  );
}

export default TripTabs;
