/**
 * The component half of the dev-only design preview (#/__design): one section per
 * components/ui primitive, showing its variants and states with the real CSS and fonts.
 * Runtime checks (axe, keyboard passes, screenshots) run against this page.
 */
import { useState, type ReactNode } from 'react';
import {
  BellRing,
  CalendarCheck,
  Ellipsis,
  ExternalLink,
  List,
  Map as MapIcon,
  Pencil,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Tent,
  Trash,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Combobox,
  ConfirmDialog,
  DateRangeField,
  Dialog,
  Disclosure,
  EmptyState,
  GuestsField,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  ProviderBadge,
  ProviderManifestsProvider,
  RadioCard,
  RadioCardGroup,
  SegmentedControl,
  Sheet,
  Stepper,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  type ComboboxOption,
  type DateRange,
  type DialogSize,
  type Guests,
  type ProviderBadgeInfo,
  Field,
  IconButton,
  Notice,
  PageHeader,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Spinner,
  StatusPill,
  Switch,
  TextField,
  Textarea,
  Tooltip,
  VisuallyHidden,
  statusPresets,
  useAnnounce,
  useToast,
  type BadgeTone,
} from '../../components/ui';
// Internal: the solid danger fill exists only as ConfirmDialog's destructive confirm. The
// gallery shows it beside the coral primary so the two can be compared.
import { ButtonBase } from '../../components/ui/Button';
import { Section } from './Section';

/** Section titles, in page order. The preview test checks each one renders. */
export const COMPONENT_SECTIONS = [
  'Button',
  'IconButton',
  'Field',
  'TextField',
  'Textarea',
  'Select',
  'Checkbox',
  'Radio and RadioGroup',
  'Switch',
  'Card',
  'Badge',
  'StatusPill',
  'ProviderBadge',
  'Spinner',
  'Skeleton',
  'EmptyState',
  'PageHeader',
  'Notice',
  'VisuallyHidden',
  'Tabs',
  'SegmentedControl',
  'RadioCard and RadioCardGroup',
  'Disclosure',
  'Dialog',
  'ConfirmDialog',
  'Sheet',
  'Menu',
  'Popover',
  'Tooltip',
  'Toast',
  'useAnnounce',
  'Combobox',
  'DateRangeField and RangeCalendar',
  'Stepper',
  'GuestsField',
] as const;

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold text-fg-secondary">{label}</h3>
      <div className="mt-4 flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 md:grid-cols-2">{children}</div>;
}

function ButtonSection() {
  const [saving, setSaving] = useState(false);
  const save = () => {
    setSaving(true);
    setTimeout(() => setSaving(false), 2000);
  };
  return (
    <Section
      title="Button"
      intro="Primary is the coral call to action, one per view. Secondary is an ink outline, ghost is quiet, danger is a crimson outline. Loading keeps the label and the focus."
    >
      <Grid>
        <Specimen label="Variants">
          <Button>Search</Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="ghost">Clear</Button>
          <Button variant="danger">Delete watch</Button>
        </Specimen>
        <Specimen label="Sizes: sm 32, md 40, lg 48">
          <Button size="sm" variant="secondary">
            Small
          </Button>
          <Button size="md" variant="secondary">
            Medium
          </Button>
          <Button size="lg" variant="secondary">
            Large
          </Button>
        </Specimen>
        <Specimen label="Icons and links">
          <Button variant="secondary" leadingIcon={<Plus size={18} />}>
            Create watch
          </Button>
          <Button
            as="a"
            href="#/__design"
            variant="ghost"
            trailingIcon={<ExternalLink size={18} />}
          >
            Open ParkStay
          </Button>
        </Specimen>
        <Specimen label="States">
          <Button variant="secondary" loading={saving} onClick={save}>
            Save changes
          </Button>
          <Button variant="secondary" loading>
            Holding site
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </Specimen>
        <Specimen label="Primary beside destructive: outline by default, solid only to confirm">
          <Button>Arm snipe</Button>
          <Button variant="danger">Delete watch</Button>
          <ButtonBase variant="danger-solid">Delete watch</ButtonBase>
        </Specimen>
      </Grid>
    </Section>
  );
}

function IconButtonSection() {
  return (
    <Section
      title="IconButton"
      intro="Icon-only buttons always carry a label: it is the accessible name and the tooltip. Hover or focus one to see it."
    >
      <Grid>
        <Specimen label="Variants">
          <IconButton label="Close" icon={<X />} />
          <IconButton label="Settings" icon={<Settings />} variant="secondary" />
          <IconButton label="Create watch" icon={<Plus />} variant="primary" />
          <IconButton label="Delete watch" icon={<Trash />} variant="danger" />
        </Specimen>
        <Specimen label="Sizes and states">
          <IconButton label="Filters, small" icon={<SlidersHorizontal size={16} />} size="sm" />
          <IconButton label="Filters, medium" icon={<SlidersHorizontal />} size="md" />
          <IconButton label="Filters, large" icon={<SlidersHorizontal size={24} />} size="lg" />
          <IconButton label="Search, unavailable" icon={<Search />} disabled />
        </Specimen>
      </Grid>
    </Section>
  );
}

function FieldSection() {
  return (
    <Section
      title="Field"
      intro="Label, hint and error around one control. The control is described by the hint and error and marked invalid; the error has an icon, not just colour."
    >
      <Grid>
        <Specimen label="Hint">
          <Field label="Watch name" hint="Only you see this" className="w-full">
            <TextField placeholder="Lucky Bay long weekend" />
          </Field>
        </Specimen>
        <Specimen label="Error">
          <Field
            label="Email"
            error="Enter an email address like name@example.com"
            required
            className="w-full"
          >
            <TextField type="email" defaultValue="lucky@" />
          </Field>
        </Specimen>
        <Specimen label="Optional">
          <Field label="Phone" optional className="w-full">
            <TextField type="tel" />
          </Field>
        </Specimen>
        <Specimen label="Disabled">
          <Field label="Provider" hint="Set when the watch was created" className="w-full">
            <TextField defaultValue="ParkStay" disabled />
          </Field>
        </Specimen>
      </Grid>
    </Section>
  );
}

function TextFieldSection() {
  return (
    <Section
      title="TextField"
      intro="Single-line text. 40 px high, border-strong edge, crimson edge when invalid."
    >
      <Grid>
        <Specimen label="Default and with a leading icon">
          <Field label="Where to" className="w-full">
            <TextField leadingIcon={<Search size={18} />} placeholder="Places, parks or towns" />
          </Field>
        </Specimen>
        <Specimen label="Invalid">
          <Field label="Postcode" error="Enter a 4-digit postcode" className="w-full">
            <TextField inputMode="numeric" defaultValue="60" />
          </Field>
        </Specimen>
      </Grid>
    </Section>
  );
}

function TextareaSection() {
  return (
    <Section title="Textarea" intro="Multi-line text, at least 80 px high.">
      <Grid>
        <Specimen label="Default">
          <Field label="Notes" hint="Private to you" className="w-full">
            <Textarea placeholder="Gear, who is coming, anything to remember" />
          </Field>
        </Specimen>
        <Specimen label="Disabled">
          <Field label="Provider notes" className="w-full">
            <Textarea defaultValue="Imported from ParkStay." disabled />
          </Field>
        </Specimen>
      </Grid>
    </Section>
  );
}

function SelectSection() {
  return (
    <Section title="Select" intro="The native select, styled. Use it for short, known lists.">
      <Grid>
        <Specimen label="Default">
          <Field
            label="Check every"
            hint="How often WA Stay checks for openings"
            className="w-full"
          >
            <Select defaultValue="60">
              <option value="15">15 minutes</option>
              <option value="60">Hour</option>
              <option value="240">4 hours</option>
            </Select>
          </Field>
        </Specimen>
        <Specimen label="Invalid">
          <Field label="Site type" error="Choose a site type" className="w-full">
            <Select defaultValue="">
              <option value="" disabled>
                Choose one
              </option>
              <option value="tent">Tent</option>
              <option value="caravan">Caravan</option>
            </Select>
          </Field>
        </Specimen>
      </Grid>
    </Section>
  );
}

function CheckboxSection() {
  return (
    <Section title="Checkbox" intro="Native checkboxes with their own label and description.">
      <Grid>
        <Specimen label="States">
          <div className="flex flex-col gap-4">
            <Checkbox label="Email me when a site is found" />
            <Checkbox label="Allow partial matches" defaultChecked />
            <Checkbox
              label="Hold a site automatically when found"
              description="Places a 30-minute hold on ParkStay. You complete payment."
            />
            <Checkbox label="Unavailable for this provider" disabled />
          </div>
        </Specimen>
      </Grid>
    </Section>
  );
}

function RadioSection() {
  const [release, setRelease] = useState('daily');
  return (
    <Section
      title="Radio and RadioGroup"
      intro="A fieldset of native radios. Arrow keys move the selection."
    >
      <Grid>
        <Specimen label="Vertical, with descriptions">
          <RadioGroup legend="When does the site open?" value={release} onValueChange={setRelease}>
            <Radio value="daily" label="Daily rollover" description="180 days ahead at midnight" />
            <Radio value="scheduled" label="Scheduled" description="A set date and time" />
            <Radio value="cancellation" label="Cancellations" description="Whenever one frees up" />
          </RadioGroup>
        </Specimen>
        <Specimen label="Horizontal, with an error">
          <RadioGroup
            legend="Site type"
            orientation="horizontal"
            error="Choose a site type"
            name="gallery-site-type"
          >
            <Radio value="tent" label="Tent" />
            <Radio value="caravan" label="Caravan" />
            <Radio value="cabin" label="Cabin" disabled />
          </RadioGroup>
        </Specimen>
      </Grid>
    </Section>
  );
}

function SwitchSection() {
  return (
    <Section
      title="Switch"
      intro="On/off settings that apply at once. The thumb's position shows the state."
    >
      <Grid>
        <Specimen label="States">
          <div className="flex w-full flex-col gap-4">
            <Switch
              label="Desktop notifications"
              description="Shown when a watch finds a site"
              defaultChecked
            />
            <Switch label="Play a sound" />
            <Switch label="Start minimised" disabled />
          </div>
        </Specimen>
      </Grid>
    </Section>
  );
}

function CardSection() {
  return (
    <Section
      title="Card"
      intro="A surface on the page: hairline, card shadow, 12 px radius. Interactive cards are links or buttons and lift on hover."
    >
      <div className="grid gap-6 md:grid-cols-3">
        <Card padding="sm">
          <p className="font-semibold">Padding sm</p>
          <p className="text-sm text-fg-secondary">16 px</p>
        </Card>
        <Card as="article" padding="lg" aria-label="Lucky Bay">
          <p className="font-semibold">Padding lg, as article</p>
          <p className="text-sm text-fg-secondary">24 px</p>
        </Card>
        <Card as="a" href="#/__design" interactive>
          <p className="font-semibold">Interactive link</p>
          <p className="text-sm text-fg-secondary">Hover or focus it</p>
        </Card>
      </div>
    </Section>
  );
}

const BADGE_TONES: { tone: BadgeTone; label: string }[] = [
  { tone: 'neutral', label: 'Neutral' },
  { tone: 'brand', label: 'Brand' },
  { tone: 'accent', label: 'Accent' },
  { tone: 'available', label: '12 sites' },
  { tone: 'warning', label: 'Hold expiring' },
  { tone: 'danger', label: 'Failed' },
  { tone: 'sun', label: 'Soon' },
];

function BadgeSection() {
  return (
    <Section
      title="Badge"
      intro="Small text labels in seven tones. Always text, never colour alone."
    >
      <Grid>
        <Specimen label="Tones">
          {BADGE_TONES.map(({ tone, label }) => (
            <Badge key={tone} tone={tone}>
              {label}
            </Badge>
          ))}
        </Specimen>
        <Specimen label="With an icon">
          <Badge tone="brand" icon={<CalendarCheck size={14} />}>
            Booked
          </Badge>
          <Badge tone="sun" icon={<BellRing size={14} />}>
            Opens at midnight
          </Badge>
        </Specimen>
      </Grid>
    </Section>
  );
}

const PRESET_GROUPS: {
  label: string;
  presets: Record<string, Parameters<typeof StatusPill>[0]>;
}[] = [
  { label: 'Watch', presets: statusPresets.watch },
  { label: 'Watch result', presets: statusPresets.watchResult },
  { label: 'Snipe', presets: statusPresets.snipe },
  { label: 'Snipe result', presets: statusPresets.snipeResult },
  { label: 'Booking', presets: statusPresets.booking },
];

function StatusPillSection() {
  return (
    <Section
      title="StatusPill"
      intro="Icon, label and tone for every watch, snipe and booking status. Live states pulse, and hold still under reduced motion."
    >
      <div className="space-y-6">
        {PRESET_GROUPS.map((group) => (
          <Specimen key={group.label} label={group.label}>
            {Object.entries(group.presets).map(([key, preset]) => (
              <StatusPill key={key} {...preset} />
            ))}
          </Specimen>
        ))}
      </div>
    </Section>
  );
}

function SpinnerSection() {
  return (
    <Section
      title="Spinner"
      intro="For waits over about 300 ms. A status with a hidden label. Prefer a skeleton when you know the shape."
    >
      <Specimen label="Sizes">
        <Spinner size="sm" label="Loading, small" />
        <Spinner size="md" label="Loading, medium" />
        <Spinner size="lg" label="Loading, large" />
      </Specimen>
    </Section>
  );
}

function SkeletonSection() {
  return (
    <Section
      title="Skeleton"
      intro="Placeholders the size of the content. Hidden from assistive technology; static under reduced motion."
    >
      <div className="grid gap-6 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-4">
            <Skeleton className="aspect-4/3 w-full rounded-lg" />
            <Skeleton shape="text" className="mt-4 w-3/4" />
            <Skeleton shape="text" className="mt-2 w-1/2" />
            <div className="mt-4 flex items-center gap-2">
              <Skeleton shape="circle" className="h-6 w-6" />
              <Skeleton shape="text" className="w-24" />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function EmptyStateSection() {
  return (
    <Section
      title="EmptyState"
      intro="What to show when there is nothing yet, and the next step. A Fraunces title and, at most, one brushstroke."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <EmptyState
            headingLevel={3}
            icon={<BellRing size={24} />}
            accent="sun"
            title="No watches yet"
            description="Pick a place and dates, and WA Stay checks for openings every few minutes."
            actions={<Button leadingIcon={<Plus size={18} />}>Create watch</Button>}
          />
        </Card>
        <Card>
          <EmptyState
            headingLevel={3}
            icon={<Search size={24} />}
            title="No places match"
            description="Try a wider area or fewer filters."
            actions={<Button variant="secondary">Clear filters</Button>}
          />
        </Card>
      </div>
    </Section>
  );
}

function PageHeaderSection() {
  return (
    <Section
      title="PageHeader"
      intro="The top of every page: its one h1, a description, actions and an optional back link. Shown here as an h3 because this page already has its h1."
    >
      <Card padding="lg">
        <PageHeader
          headingLevel={3}
          title="Lucky Bay long weekend"
          description="Watching 3 sites at Lucky Bay for Fri 3 – Sun 5 Oct."
          back={{ label: 'Watches', href: '#/__design' }}
          actions={
            <>
              <Button variant="secondary">Edit</Button>
              <Button>Check now</Button>
            </>
          }
        />
      </Card>
    </Section>
  );
}

function NoticeSection() {
  const [shown, setShown] = useState(true);
  return (
    <Section
      title="Notice"
      intro="Inline banners. Info, success and warning are statuses; danger is an alert. Each has an icon and words, not just a tint."
    >
      <div className="grid gap-4">
        <Notice tone="info" title="Book responsibly">
          One DBCA account per person, one booking per night, and only for a stay you mean to take.
        </Notice>
        <Notice tone="success">Your email notifier is working.</Notice>
        <Notice tone="warning" title="Hold expires in 12 minutes">
          Complete payment on ParkStay to keep the site.
        </Notice>
        <Notice
          tone="danger"
          title="ParkStay didn't respond"
          actions={
            <Button size="sm" variant="secondary">
              Try again
            </Button>
          }
        >
          Try again in a minute.
        </Notice>
        {shown ? (
          <Notice tone="info" onDismiss={() => setShown(false)}>
            Dismissible: the close button has a name and a tooltip.
          </Notice>
        ) : (
          <Button variant="ghost" onClick={() => setShown(true)}>
            Show the dismissible notice again
          </Button>
        )}
      </div>
    </Section>
  );
}

function VisuallyHiddenSection() {
  return (
    <Section
      title="VisuallyHidden"
      intro="Text for screen readers only. The nav link below reads as 'Bookings, coming soon'."
    >
      <Specimen label="In a name">
        <a
          href="#/__design"
          className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-fg hover:bg-surface-subtle"
        >
          Bookings
          <Badge tone="sun">Soon</Badge>
          <VisuallyHidden>, coming soon</VisuallyHidden>
        </a>
      </Specimen>
    </Section>
  );
}

function TooltipSection() {
  return (
    <Section
      title="Tooltip"
      intro="Short help on hover (after 400 ms) or focus (at once). Escape, blur or leaving closes it. It describes its trigger."
    >
      <Specimen label="Describing a button">
        <Tooltip content="Checks every 5 minutes">
          <Button variant="secondary">Check now</Button>
        </Tooltip>
        <Tooltip content="Opens in your browser" side="bottom">
          <Button variant="ghost" trailingIcon={<ExternalLink size={18} />}>
            ParkStay
          </Button>
        </Tooltip>
      </Specimen>
    </Section>
  );
}

function ToastSection() {
  const toast = useToast();
  return (
    <Section
      title="Toast"
      intro="Brief confirmations in the Notifications region. Success and info close after 5 s, warnings after 8 s, errors stay. At most three show; the rest queue. Hover or focus pauses a toast."
    >
      <Specimen label="Show one">
        <Button variant="secondary" onClick={() => toast.success('Watch saved')}>
          Success
        </Button>
        <Button variant="secondary" onClick={() => toast.info('Catalogue refreshed: 169 places')}>
          Info
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast.warning('ParkStay is slow to respond today')}
        >
          Warning
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast.error("ParkStay didn't respond. Try again in a minute.")}
        >
          Error
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast.info('Watch deleted', {
              action: { label: 'Undo', onClick: () => toast.success('Watch restored') },
            })
          }
        >
          With an action
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            toast.error('First of four');
            toast.error('Second of four');
            toast.error('Third of four');
            toast.success('Fourth of four: queued until one closes');
          }}
        >
          Queue four
        </Button>
      </Specimen>
    </Section>
  );
}

function AnnounceSection() {
  const announce = useAnnounce();
  const [count, setCount] = useState(3);
  return (
    <Section
      title="useAnnounce"
      intro="Speaks a message through a hidden live region outside #root, so it still works while a dialog is open. Polite by default."
    >
      <Specimen label="Announce">
        <Button
          variant="secondary"
          onClick={() => {
            announce(`${count} results`);
            setCount((n) => (n === 3 ? 12 : 3));
          }}
        >
          Announce a result count
        </Button>
        <Button variant="ghost" onClick={() => announce('Hold expires in 1 minute', 'assertive')}>
          Announce assertively
        </Button>
      </Specimen>
    </Section>
  );
}

/** Sample provider data. Brand colours are data from provider manifests, not design tokens. */
const SAMPLE_PROVIDERS: ProviderBadgeInfo[] = [
  {
    id: 'parkstay',
    name: 'ParkStay WA',
    shortName: 'ParkStay',
    brand: { color: '#2D6A4F', monogram: 'PS' }, // token-guard-ignore: provider brand data
  },
  {
    id: 'rac',
    name: 'RAC Parks & Resorts',
    shortName: 'RAC',
    brand: { color: '#F5C400', monogram: 'RAC' }, // token-guard-ignore: provider brand data
  },
  {
    id: 'grey',
    name: 'Grey Example Stays',
    shortName: 'Grey',
    brand: { color: '#777777', monogram: 'GR' }, // token-guard-ignore: low-contrast example
  },
];

function ProviderBadgeSection() {
  return (
    <Section
      title="ProviderBadge"
      intro="Whose system something belongs to: a coloured monogram and the short name. Text on the brand colour is white or ink, whichever passes; a colour where neither reaches 4.5:1 gets the outlined style."
    >
      <ProviderManifestsProvider manifests={SAMPLE_PROVIDERS}>
        <Grid>
          <Specimen label="Full, md and sm">
            <ProviderBadge providerId="parkstay" />
            <ProviderBadge providerId="rac" />
            <ProviderBadge providerId="parkstay" size="sm" />
          </Specimen>
          <Specimen label="Compact (named by the provider)">
            <ProviderBadge providerId="parkstay" variant="compact" />
            <ProviderBadge providerId="rac" variant="compact" />
            <ProviderBadge providerId="rac" variant="compact" size="sm" />
          </Specimen>
          <Specimen label="Outlined: brand colour fails both texts">
            <ProviderBadge providerId="grey" />
            <ProviderBadge providerId="grey" variant="compact" />
          </Specimen>
          <Specimen label="Unknown provider">
            <ProviderBadge providerId="airbnb" />
            <ProviderBadge providerId="airbnb" variant="compact" size="sm" />
          </Specimen>
        </Grid>
      </ProviderManifestsProvider>
    </Section>
  );
}

function TabsSection() {
  return (
    <Section
      title="Tabs"
      intro="Arrow keys move between tabs and select them; only the selected tab is in the tab order. The selected tab is bold and underlined, not only coloured."
    >
      <Card padding="lg">
        <Tabs defaultValue="overview">
          <TabList aria-label="Location details">
            <Tab value="overview">Overview</Tab>
            <Tab value="sites">Sites</Tab>
            <Tab value="rules">Booking rules</Tab>
            <Tab value="reviews" disabled>
              Reviews
            </Tab>
          </TabList>
          <TabPanel value="overview">
            Camp among the peppermint trees, a short walk from the beach.
          </TabPanel>
          <TabPanel value="sites">24 sites, 8 with power.</TabPanel>
          <TabPanel value="rules">Opens 180 days ahead at midnight AWST.</TabPanel>
          <TabPanel value="reviews">Not available yet.</TabPanel>
        </Tabs>
      </Card>
    </Section>
  );
}

function SegmentedControlSection() {
  return (
    <Section
      title="SegmentedControl"
      intro="Two to four views of the same thing. A radio group: arrow keys move the selection."
    >
      <Specimen label="With icons">
        <SegmentedControl
          label="View"
          options={[
            { value: 'map', label: 'Map', icon: <MapIcon size={16} /> },
            { value: 'list', label: 'List', icon: <List size={16} /> },
          ]}
          defaultValue="map"
        />
        <SegmentedControl
          label="Sort"
          options={[
            { value: 'near', label: 'Nearest' },
            { value: 'az', label: 'A to Z' },
            { value: 'sites', label: 'Most sites', disabled: true },
          ]}
          defaultValue="near"
        />
      </Specimen>
    </Section>
  );
}

function RadioCardSection() {
  return (
    <Section
      title="RadioCard and RadioCardGroup"
      intro="Big, described choices such as the provider step. Each card is a native radio named by its title and described by its description; arrow keys move the selection."
    >
      <div className="max-w-xl">
        <ProviderManifestsProvider manifests={SAMPLE_PROVIDERS}>
          <RadioCardGroup
            label="Provider"
            hint="Watches check this provider's availability."
            defaultValue="parkstay"
          >
            <RadioCard
              value="parkstay"
              title="ParkStay WA"
              description="National park campgrounds across WA"
              icon={<Tent />}
              trailing={<ProviderBadge providerId="parkstay" variant="compact" />}
            />
            <RadioCard
              value="rac"
              title="RAC Parks & Resorts"
              description="Holiday parks and cabins"
              trailing={<Badge tone="sun">Soon</Badge>}
              disabled
            />
          </RadioCardGroup>
        </ProviderManifestsProvider>
      </div>
    </Section>
  );
}

function DisclosureSection() {
  return (
    <Section
      title="Disclosure"
      intro="Show and hide a region. The chevron turns when open and holds still under reduced motion."
    >
      <Card padding="lg" className="max-w-xl">
        <Disclosure summary="Advanced options">
          Poll every 2 seconds for 10 minutes after the release time, then every minute.
        </Disclosure>
        <Disclosure summary="Why can't I pick a later date?" defaultOpen>
          ParkStay opens bookings 180 days ahead.
        </Disclosure>
      </Card>
    </Section>
  );
}

function DialogSection() {
  const [size, setSize] = useState<DialogSize | null>(null);
  const [nested, setNested] = useState(false);
  return (
    <Section
      title="Dialog"
      intro="Modal: focus is trapped inside and returns to the opener; Escape and the overlay close it; the page behind is inert. A Popover inside closes first on Escape."
    >
      <Specimen label="Sizes">
        {(['sm', 'md', 'lg', 'full'] as DialogSize[]).map((s) => (
          <Button key={s} variant="secondary" onClick={() => setSize(s)}>
            Open {s} dialog
          </Button>
        ))}
      </Specimen>
      <Dialog
        open={size !== null}
        onClose={() => setSize(null)}
        title="Edit watch"
        description="Changes apply from the next check."
        size={size ?? 'md'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSize(null)}>
              Cancel
            </Button>
            <Button onClick={() => setSize(null)}>Save changes</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Watch name">
            <TextField defaultValue="Lucky Bay long weekend" />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Popover
              label="Check frequency"
              trigger={<Button variant="secondary">Frequency</Button>}
            >
              <p className="max-w-xs text-sm text-fg-secondary">
                Escape closes this popover and leaves the dialog open.
              </p>
            </Popover>
            <Button variant="ghost" onClick={() => setNested(true)}>
              Open a second dialog
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog open={nested} onClose={() => setNested(false)} title="Second dialog" size="sm">
        <p className="text-fg-secondary">Escape closes this one first.</p>
      </Dialog>
    </Section>
  );
}

function ConfirmDialogSection() {
  const toast = useToast();
  const [which, setWhich] = useState<'danger' | 'primary' | 'failing' | null>(null);
  const [reported, setReported] = useState(0);
  return (
    <Section
      title="ConfirmDialog"
      intro="An alertdialog. Danger focuses Cancel first and uses the only solid (deep crimson) danger button in the app. An async confirm shows loading until it settles; if it fails, the dialog stays open with the error, and toasts fired meanwhile stay clickable."
    >
      <Specimen label="Tones">
        <Button variant="danger" onClick={() => setWhich('danger')}>
          Delete watch
        </Button>
        <Button variant="secondary" onClick={() => setWhich('primary')}>
          Arm snipe
        </Button>
        <Button variant="secondary" onClick={() => setWhich('failing')}>
          Cancel booking (fails)
        </Button>
        {reported > 0 && (
          <p className="text-sm text-fg-secondary">Toast action pressed {reported}×</p>
        )}
      </Specimen>
      <ConfirmDialog
        open={which === 'danger'}
        tone="danger"
        title="Delete this watch?"
        message="WA Stay stops checking Lucky Bay. This cannot be undone."
        confirmLabel="Delete watch"
        onCancel={() => setWhich(null)}
        onConfirm={() =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              resolve();
              setWhich(null);
              toast.success('Watch deleted');
            }, 1500)
          )
        }
      />
      <ConfirmDialog
        open={which === 'primary'}
        tone="primary"
        title="Arm this snipe?"
        message="WA Stay will try to hold a site at midnight AWST."
        confirmLabel="Arm snipe"
        onCancel={() => setWhich(null)}
        onConfirm={() => setWhich(null)}
      />
      <ConfirmDialog
        open={which === 'failing'}
        tone="danger"
        title="Cancel this booking?"
        message="Your site at Lucky Bay is released for others to book."
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        onCancel={() => setWhich(null)}
        onConfirm={() =>
          new Promise<void>((_, reject) =>
            setTimeout(() => {
              toast.error("Couldn't cancel the booking.", {
                action: { label: 'Report', onClick: () => setReported((n) => n + 1) },
              });
              reject(new Error("ParkStay didn't respond. Try again in a minute."));
            }, 800)
          )
        }
      />
    </Section>
  );
}

function SheetSection() {
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Sheet"
      intro="A Dialog from the right edge, full height: filters, details, long forms."
    >
      <Specimen label="Right sheet">
        <Button
          variant="secondary"
          leadingIcon={<SlidersHorizontal size={18} />}
          onClick={() => setOpen(true)}
        >
          Filters
        </Button>
      </Specimen>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Clear all
            </Button>
            <Button onClick={() => setOpen(false)}>Show 24 places</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Checkbox label="Powered sites" />
          <Checkbox label="Dogs permitted" />
          <Checkbox label="Campfires allowed" />
        </div>
      </Sheet>
    </Section>
  );
}

function MenuSection() {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <Section
      title="Menu"
      intro="A menu button. ↑/↓/Home/End move, Enter or Space chooses, Escape or Tab closes and refocuses the trigger. A dialog opened from an item returns focus to the trigger."
    >
      <Specimen label="Button and IconButton triggers">
        <Menu trigger={<Button variant="secondary">Watch actions</Button>}>
          <MenuItem icon={<Pencil size={16} />} onSelect={() => setRenaming(true)}>
            Rename
          </MenuItem>
          <MenuItem href="#/__design" icon={<ExternalLink size={16} />}>
            Open on ParkStay
          </MenuItem>
          <MenuItem disabled>Duplicate</MenuItem>
          <MenuSeparator />
          <MenuItem tone="danger" icon={<Trash size={16} />} onSelect={() => setDeleting(true)}>
            Delete
          </MenuItem>
        </Menu>
        <Menu
          align="end"
          trigger={<IconButton label="More actions" icon={<Ellipsis />} variant="secondary" />}
        >
          <MenuItem onSelect={() => toast.info('Watch paused')}>Pause</MenuItem>
          <MenuItem onSelect={() => toast.info('Checking now')}>Check now</MenuItem>
        </Menu>
      </Specimen>
      <Dialog open={renaming} onClose={() => setRenaming(false)} title="Rename watch" size="sm">
        <Field label="Watch name">
          <TextField defaultValue="Lucky Bay long weekend" />
        </Field>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        title="Delete this watch?"
        message="This cannot be undone."
        confirmLabel="Delete watch"
        onCancel={() => setDeleting(false)}
        onConfirm={() => setDeleting(false)}
      />
    </Section>
  );
}

function PopoverSection() {
  return (
    <Section
      title="Popover"
      intro="A non-modal dialog anchored to its trigger. Focus moves in; Escape or a click outside closes it and returns focus. It flips above and clamps at the window edges."
    >
      <Specimen label="Below, and near the right edge">
        <Popover label="Price" trigger={<Button variant="secondary">Price</Button>}>
          {({ close }) => (
            <div className="flex w-64 flex-col gap-3">
              <Field label="Up to">
                <TextField inputMode="numeric" defaultValue="60" />
              </Field>
              <Button size="sm" variant="secondary" onClick={close}>
                Done
              </Button>
            </div>
          )}
        </Popover>
        <div className="ml-auto">
          <Popover label="Sort" align="end" trigger={<Button variant="ghost">Sort</Button>}>
            <p className="w-56 text-sm text-fg-secondary">
              End-aligned so it never leaves the window.
            </p>
          </Popover>
        </div>
      </Specimen>
    </Section>
  );
}

const PLACES: ComboboxOption[] = [
  {
    value: 'parkstay:1',
    label: 'Lucky Bay',
    description: 'Cape Le Grand National Park',
    group: 'Campgrounds',
  },
  {
    value: 'parkstay:2',
    label: 'Le Grand Beach',
    description: 'Cape Le Grand National Park',
    group: 'Campgrounds',
  },
  {
    value: 'parkstay:3',
    label: 'Cape Arid',
    description: 'Cape Arid National Park',
    group: 'Campgrounds',
  },
  { value: 'area:cape-le-grand', label: 'Cape Le Grand National Park', group: 'Parks' },
  {
    value: 'area:esperance',
    label: 'Esperance',
    description: 'Goldfields-Esperance',
    group: 'Towns',
  },
  {
    value: 'area:denham',
    label: 'Denham',
    description: 'Not served yet',
    group: 'Towns',
    disabled: true,
  },
];

function ComboboxSection() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Section
      title="Combobox"
      intro="Type to filter; ↑/↓ highlight (aria-activedescendant), Enter chooses, Escape closes and a second Escape clears. Grouped options, a No matches row, and a segment look for the search pill."
    >
      <Grid>
        <Specimen label="Field, grouped">
          <div className="w-full">
            <Combobox
              label="Campground"
              hint="Start typing a place, park or town"
              options={PLACES}
              value={value}
              onChange={setValue}
              placeholder="Lucky Bay"
            />
          </div>
        </Specimen>
        <Specimen label="Invalid">
          <div className="w-full">
            <Combobox label="Campground" options={PLACES} error="Choose a campground" />
          </div>
        </Specimen>
      </Grid>
    </Section>
  );
}

function DateRangeSection() {
  const [range, setRange] = useState<DateRange>({});
  const today = new Date();
  const minDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  return (
    <Section
      title="DateRangeField and RangeCalendar"
      intro="Check-in and check-out as YYYY-MM-DD strings. Two months at 640 px and wider. Arrows move by day and week, PgUp/PgDn by month, Home/End to the week's ends; Enter picks. Here stays are up to 14 nights."
    >
      <Grid>
        <Specimen label="Field">
          <div className="w-full">
            <DateRangeField
              value={range}
              onChange={setRange}
              minDate={minDate}
              maxNights={14}
              hint="From today, up to 14 nights"
            />
          </div>
        </Specimen>
        <Specimen label="Value">
          <p className="text-sm tabular-nums text-fg-secondary">
            arrival: {range.arrival ?? 'none'} · departure: {range.departure ?? 'none'}
          </p>
        </Specimen>
      </Grid>
    </Section>
  );
}

function StepperSection() {
  const [vehicles, setVehicles] = useState(1);
  return (
    <Section
      title="Stepper"
      intro="A number nudged with − and +, in a group named by its label. Buttons disable at the limits; the value is announced politely."
    >
      <Card padding="lg" className="max-w-md">
        <Stepper
          label="Vehicles"
          hint="Including trailers, up to 2"
          value={vehicles}
          onChange={setVehicles}
          min={0}
          max={2}
        />
      </Card>
    </Section>
  );
}

function GuestsSection() {
  const [guests, setGuests] = useState<Guests | undefined>();
  const [where, setWhere] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({});
  return (
    <Section
      title="GuestsField"
      intro="Adults, children and infants in one field. Below, the segment look of Combobox, DateRangeField and GuestsField, as E1's search pill will compose them."
    >
      <div className="space-y-6">
        <Grid>
          <Specimen label="Field">
            <div className="w-full">
              <GuestsField value={guests} onChange={setGuests} />
            </div>
          </Specimen>
        </Grid>
        <Specimen label="Segments with a hint and errors (the hint is read, not shown)">
          <div className="flex w-full flex-wrap items-start gap-1 rounded-full border border-border bg-surface p-1 shadow-pill">
            <Combobox
              label="Where"
              appearance="segment"
              options={PLACES}
              hint="A place, park or town"
              placeholder="Search places"
              className="min-w-48 flex-1"
            />
            <DateRangeField
              appearance="segment"
              value={{}}
              onChange={() => undefined}
              error="Add your dates"
            />
            <GuestsField appearance="segment" onChange={() => undefined} error="Add guests" />
          </div>
        </Specimen>
        <Specimen label="Segments in a pill">
          <div className="flex w-full flex-wrap items-center gap-1 rounded-full border border-border bg-surface p-1 shadow-pill">
            <Combobox
              label="Where"
              appearance="segment"
              options={PLACES}
              value={where}
              onChange={setWhere}
              placeholder="Search places"
              className="min-w-48 flex-1"
            />
            <DateRangeField appearance="segment" value={range} onChange={setRange} />
            <GuestsField appearance="segment" value={guests} onChange={setGuests} />
            <IconButton
              label="Search"
              icon={<Search />}
              variant="primary"
              className="rounded-full"
            />
          </div>
        </Specimen>
      </div>
    </Section>
  );
}

export function ComponentGallery() {
  return (
    <>
      <ButtonSection />
      <IconButtonSection />
      <FieldSection />
      <TextFieldSection />
      <TextareaSection />
      <SelectSection />
      <CheckboxSection />
      <RadioSection />
      <SwitchSection />
      <CardSection />
      <BadgeSection />
      <StatusPillSection />
      <ProviderBadgeSection />
      <SpinnerSection />
      <SkeletonSection />
      <EmptyStateSection />
      <PageHeaderSection />
      <NoticeSection />
      <VisuallyHiddenSection />
      <TabsSection />
      <SegmentedControlSection />
      <RadioCardSection />
      <DisclosureSection />
      <DialogSection />
      <ConfirmDialogSection />
      <SheetSection />
      <MenuSection />
      <PopoverSection />
      <TooltipSection />
      <ToastSection />
      <AnnounceSection />
      <ComboboxSection />
      <DateRangeSection />
      <StepperSection />
      <GuestsSection />
    </>
  );
}

export default ComponentGallery;
