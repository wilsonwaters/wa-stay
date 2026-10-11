import { AppWindow, Bell, CircleUser, Info, type LucideIcon } from 'lucide-react';

/** Settings' sections, in sub-navigation order. Each is a route: `/settings/<id>`. */
export const SETTINGS_SECTIONS = [
  {
    id: 'accounts',
    label: 'Accounts',
    description: 'Your accounts with the places WA Stay checks and books through.',
    icon: CircleUser,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'How WA Stay tells you when something is found or held.',
    icon: Bell,
  },
  {
    id: 'app',
    label: 'App',
    description: 'How WA Stay starts.',
    icon: AppWindow,
  },
  {
    id: 'about',
    label: 'About',
    heading: 'About WA Stay',
    description: 'The version you have, updates, and where to get help.',
    icon: Info,
  },
] as const satisfies readonly {
  id: string;
  /** The sub-navigation label, and the section's heading unless `heading` says otherwise. */
  label: string;
  heading?: string;
  description: string;
  icon: LucideIcon;
}[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

/** Where `/settings` (or an unknown section) goes. */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'accounts';

export function isSettingsSection(value: string | undefined): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

/** A section's heading, label and description. */
export function settingsSection(id: SettingsSectionId): {
  label: string;
  heading: string;
  description: string;
} {
  const section: { label: string; heading?: string; description: string } =
    SETTINGS_SECTIONS.find((s) => s.id === id) ?? SETTINGS_SECTIONS[0];
  return { ...section, heading: section.heading ?? section.label };
}
