/**
 * WA Stay design-system primitives. Build every screen from these and the design tokens.
 * Usage notes and do/don't: docs/design/components.md.
 */

// Atoms (D1)
export {
  Brushstroke,
  type BrushstrokeProps,
  type BrushstrokeTone,
  type BrushstrokeVariant,
} from './Brushstroke';
export { PhotoPlaceholder, type PhotoPlaceholderProps } from './PhotoPlaceholder';
export { KIND_ICONS, kindIcon, type LocationKindName } from './kindIcons';

// Actions
export {
  Button,
  type ButtonProps,
  type ButtonShape,
  type ButtonSize,
  type ButtonVariant,
} from './Button';
export { IconButton, type IconButtonProps } from './IconButton';
export { Chip, type ChipProps } from './Chip';

// Form
export { Field, type FieldProps } from './Field';
export { TextField, type TextFieldProps } from './TextField';
export { Textarea, type TextareaProps } from './Textarea';
export { Select, type SelectProps } from './Select';
export { Checkbox, type CheckboxProps } from './Checkbox';
export { Radio, RadioGroup, type RadioGroupProps, type RadioProps } from './Radio';
export { Switch, type SwitchProps } from './Switch';

// Display
export { Card, type CardPadding, type CardProps } from './Card';
export { Badge, type BadgeProps, type BadgeTone } from './Badge';
export { StatusPill, type StatusPillProps } from './StatusPill';
export { statusPresets, type StatusPreset } from './statusPresets';
export { Spinner, type SpinnerProps, type SpinnerSize } from './Spinner';
export { Skeleton, type SkeletonProps } from './Skeleton';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { BackLink, PageHeader, type BackLinkProps, type PageHeaderProps } from './PageHeader';
export { Notice, type NoticeProps, type NoticeTone } from './Notice';
export { VisuallyHidden, type VisuallyHiddenProps } from './VisuallyHidden';
export {
  ProviderBadge,
  ProviderManifestsContext,
  ProviderManifestsProvider,
  type ProviderBadgeInfo,
  type ProviderBadgeProps,
} from './ProviderBadge';
export { readableTextOn, type MonogramStyle } from './brandContrast';

// Navigation and choice
export {
  Tabs,
  TabList,
  Tab,
  TabPanel,
  type TabsProps,
  type TabListProps,
  type TabProps,
  type TabPanelProps,
} from './Tabs';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from './SegmentedControl';
export {
  RadioCard,
  RadioCardGroup,
  type RadioCardProps,
  type RadioCardGroupProps,
} from './RadioCard';
export { Disclosure, type DisclosureProps } from './Disclosure';

// Overlays
export { Dialog, type DialogProps, type DialogSize } from './Dialog';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
export { Sheet, type SheetProps } from './Sheet';
export { Menu, MenuItem, MenuSeparator, type MenuProps, type MenuItemProps } from './Menu';
export { Popover, type PopoverProps } from './Popover';
export { Tooltip, type TooltipProps } from './Tooltip';
export { Portal } from './Portal';
export {
  OverlayStack,
  OverlayStackContext,
  useOverlay,
  type UseOverlayOptions,
} from './OverlayStack';

// Feedback
export {
  ToastProvider,
  ToastViewport,
  useToast,
  type ToastAction,
  type ToastApi,
  type ToastOptions,
  type ToastTone,
} from './Toast';

// Search fields
export { Combobox, type ComboboxOption, type ComboboxProps } from './Combobox';
export { DateRangeField, type DateRangeFieldProps } from './DateRangeField';
export { RangeCalendar, type RangeCalendarProps } from './RangeCalendar';
export type { DateRange, IsoDate } from './calendar';
export { Stepper, type StepperProps } from './Stepper';
export {
  GuestsField,
  DEFAULT_GUEST_HINTS,
  DEFAULT_GUEST_LIMITS,
  guestsSummary,
  type Guests,
  type GuestsFieldProps,
  type GuestLimits,
} from './GuestsField';

// Hooks
export { useFocusTrap, getTabbables, type FocusTrapOptions } from './useFocusTrap';
export { useDisclosure, type UseDisclosureOptions } from './useDisclosure';
export { AnnouncerProvider, useAnnounce, type Announce, type Politeness } from './useAnnounce';
export { usePosition, type UsePositionOptions } from './usePosition';
export {
  computePosition,
  type Align,
  type Position,
  type PositionInput,
  type Side,
} from './position';
