/**
 * Dev-only design preview at #/__design. Renders the live tokens, the contrast pairs,
 * type, spacing, radii, elevation, motion, icons and the D1 atoms with the real fonts
 * and CSS, so runtime checks (screenshots, axe, keyboard) have one stable page.
 *
 * Registered only when import.meta.env.DEV, so it never reaches the production bundle.
 */
import { useMemo, useState } from 'react';
import {
  Accessibility,
  ArrowLeft,
  Bell,
  BellRing,
  CalendarCheck,
  CalendarClock,
  CalendarRange,
  CarFront,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleQuestionMark,
  CircleUser,
  Clock,
  Compass,
  CookingPot,
  Dog,
  Droplet,
  ExternalLink,
  Flame,
  Footprints,
  Hourglass,
  Info,
  List,
  LoaderCircle,
  Map as MapIcon,
  MapPin,
  Minus,
  PlugZap,
  Plus,
  Sailboat,
  Search,
  Settings,
  ShowerHead,
  SlidersHorizontal,
  Timer,
  Toilet,
  TriangleAlert,
  Users,
  Waves,
  X,
  type LucideIcon,
} from 'lucide-react';
import tokensCss from '../../styles/tokens.css?raw';
import {
  checkContrastPairs,
  contrastRatio,
  parseTokens,
  type TokenSheet,
} from '../../styles/contrast';
import {
  Brushstroke,
  type BrushstrokeTone,
  type BrushstrokeVariant,
} from '../../components/ui/Brushstroke';
import { PhotoPlaceholder } from '../../components/ui/PhotoPlaceholder';
import { KIND_ICONS } from '../../components/ui/kindIcons';
import { Logo } from '../../components/brand/Logo';
import markMonoUrl from '../../assets/brand/logo-mark-mono.svg';
import { ComponentGallery } from './ComponentGallery';
import { Section } from './Section';

const PALETTE: { family: string; note: string; tokens: string[]; decorative?: string[] }[] = [
  {
    family: 'Ink',
    note: 'The black swan. Text and dark surfaces.',
    tokens: ['ink-900', 'ink-700'],
  },
  {
    family: 'Sand',
    note: 'Warm neutrals for the page, fills and hairlines.',
    tokens: ['sand-0', 'sand-50', 'sand-100', 'sand-200', 'sand-500', 'sand-600'],
  },
  {
    family: 'Ocean',
    note: 'Indian Ocean blue. The brand colour.',
    tokens: ['ocean-50', 'ocean-100', 'ocean-200', 'ocean-500', 'ocean-600', 'ocean-700'],
  },
  {
    family: 'Coral',
    note: 'The single call-to-action colour.',
    tokens: ['coral-50', 'coral-400', 'coral-600', 'coral-700'],
    decorative: ['coral-400'],
  },
  {
    family: 'Sun',
    note: 'Time and release cues, the Soon pill.',
    tokens: ['sun-50', 'sun-100', 'sun-400', 'sun-700'],
    decorative: ['sun-400'],
  },
  {
    family: 'Eucalypt',
    note: 'Available, success.',
    tokens: ['eucalypt-50', 'eucalypt-600', 'eucalypt-700'],
  },
  {
    family: 'Danger',
    note: 'Crimson, kept clear of coral.',
    tokens: ['danger-50', 'danger-600', 'danger-700'],
  },
];

const SEMANTIC: { group: string; tokens: string[] }[] = [
  { group: 'Surfaces', tokens: ['canvas', 'surface', 'surface-subtle', 'surface-inverse'] },
  { group: 'Text', tokens: ['fg', 'fg-secondary', 'fg-muted', 'fg-inverse'] },
  { group: 'Lines and focus', tokens: ['border', 'border-strong', 'focus'] },
  { group: 'Brand', tokens: ['brand', 'brand-strong', 'brand-subtle'] },
  { group: 'Accent (CTA)', tokens: ['accent', 'accent-hover', 'accent-subtle', 'accent-fg'] },
  {
    group: 'Status',
    tokens: [
      'available',
      'available-subtle',
      'available-fg',
      'warning-subtle',
      'warning-fg',
      'danger',
      'danger-subtle',
      'danger-fg',
      'sun',
      'sun-subtle',
    ],
  },
];

const TYPE_SCALE: { token: string; className: string; sample: string; display?: boolean }[] = [
  {
    token: 'display-lg',
    className: 'font-display text-display-lg font-medium',
    sample: 'Lucky Bay',
    display: true,
  },
  {
    token: 'display-md',
    className: 'font-display text-display-md font-medium',
    sample: 'Cape Le Grand National Park',
    display: true,
  },
  {
    token: 'display-sm',
    className: 'font-display text-display-sm font-medium',
    sample: 'Nothing saved yet',
    display: true,
  },
  { token: '2xl', className: 'text-2xl font-semibold', sample: 'Watches' },
  { token: 'xl', className: 'text-xl font-semibold', sample: 'Your stay' },
  { token: 'lg', className: 'text-lg font-semibold', sample: 'Fri 3 Oct 2026, 2 nights' },
  {
    token: 'base',
    className: 'text-base',
    sample: 'Camp among the peppermint trees, a short walk from the beach.',
  },
  { token: 'sm', className: 'text-sm', sample: '24 sites available for 3–5 Oct' },
  { token: 'xs', className: 'text-xs text-fg-muted', sample: 'Checked 2 minutes ago' },
];

const SPACING = [1, 2, 3, 4, 6, 8, 12, 16];
const RADII = ['sm', 'md', 'lg', 'xl', '2xl', 'full'];
const RADIUS_CLASS: Record<string, string> = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  full: 'rounded-full',
};
const SHADOWS: { token: string; className: string; usage: string }[] = [
  { token: 'card', className: 'shadow-card', usage: 'Cards resting on the page' },
  { token: 'pill', className: 'shadow-pill', usage: 'Search pill, map pills' },
  { token: 'pop', className: 'shadow-pop', usage: 'Menus, popovers, hovered cards' },
  { token: 'modal', className: 'shadow-modal', usage: 'Dialogs and sheets' },
];

type IconRow = { icon: LucideIcon; name: string; meaning: string };
const ICON_GROUPS: { title: string; icons: IconRow[] }[] = [
  {
    title: 'Location kinds',
    icons: Object.entries(KIND_ICONS).map(([kind, icon]) => ({
      icon,
      name: icon.displayName ?? kind,
      meaning: kind,
    })),
  },
  {
    title: 'Amenities',
    icons: [
      { icon: Toilet, name: 'Toilet', meaning: 'Toilets' },
      { icon: ShowerHead, name: 'ShowerHead', meaning: 'Showers' },
      { icon: Droplet, name: 'Droplet', meaning: 'Drinking water' },
      { icon: PlugZap, name: 'PlugZap', meaning: 'Powered sites' },
      { icon: Flame, name: 'Flame', meaning: 'Campfires allowed' },
      { icon: CookingPot, name: 'CookingPot', meaning: 'Camp kitchen, barbecue' },
      { icon: Dog, name: 'Dog', meaning: 'Dogs permitted' },
      { icon: CarFront, name: 'CarFront', meaning: '2WD road access' },
      { icon: Accessibility, name: 'Accessibility', meaning: 'Wheelchair access' },
      { icon: Sailboat, name: 'Sailboat', meaning: 'Boat ramp' },
      { icon: Waves, name: 'Waves', meaning: 'Beach, swimming' },
      { icon: Footprints, name: 'Footprints', meaning: 'Walk trails' },
      { icon: MapPin, name: 'MapPin', meaning: 'Any other facility' },
    ],
  },
  {
    title: 'Availability and status',
    icons: [
      { icon: Check, name: 'Check', meaning: 'Available night' },
      { icon: X, name: 'X', meaning: 'Booked night' },
      { icon: Minus, name: 'Minus', meaning: 'Closed night' },
      { icon: Clock, name: 'Clock', meaning: 'Not released yet' },
      { icon: CircleQuestionMark, name: 'CircleQuestionMark', meaning: 'Unknown' },
      { icon: LoaderCircle, name: 'LoaderCircle', meaning: 'Loading' },
      { icon: CircleCheck, name: 'CircleCheck', meaning: 'Success' },
      { icon: TriangleAlert, name: 'TriangleAlert', meaning: 'Warning' },
      { icon: CircleAlert, name: 'CircleAlert', meaning: 'Error' },
      { icon: Info, name: 'Info', meaning: 'Information' },
      { icon: Hourglass, name: 'Hourglass', meaning: 'Queue, waiting room' },
      { icon: Timer, name: 'Timer', meaning: 'Hold countdown' },
    ],
  },
  {
    title: 'Navigation and actions',
    icons: [
      { icon: Compass, name: 'Compass', meaning: 'Explore' },
      { icon: BellRing, name: 'BellRing', meaning: 'Watches' },
      { icon: CalendarClock, name: 'CalendarClock', meaning: 'Site Sniper' },
      { icon: CalendarCheck, name: 'CalendarCheck', meaning: 'Bookings' },
      { icon: Settings, name: 'Settings', meaning: 'Settings' },
      { icon: CircleUser, name: 'CircleUser', meaning: 'Account menu' },
      { icon: Bell, name: 'Bell', meaning: 'Notifications' },
      { icon: Search, name: 'Search', meaning: 'Search' },
      { icon: SlidersHorizontal, name: 'SlidersHorizontal', meaning: 'Filters' },
      { icon: CalendarRange, name: 'CalendarRange', meaning: 'Dates' },
      { icon: Users, name: 'Users', meaning: 'Guests' },
      { icon: MapIcon, name: 'Map', meaning: 'Map view' },
      { icon: List, name: 'List', meaning: 'List view' },
      { icon: ExternalLink, name: 'ExternalLink', meaning: 'Opens the provider site' },
      { icon: Plus, name: 'Plus', meaning: 'Create' },
      { icon: ArrowLeft, name: 'ArrowLeft', meaning: 'Back' },
      { icon: ChevronDown, name: 'ChevronDown', meaning: 'Expand, menu' },
      { icon: X, name: 'X', meaning: 'Close, remove' },
    ],
  },
];

const BRUSH_VARIANTS: { variant: BrushstrokeVariant; usage: string; size: string }[] = [
  { variant: 'underline', usage: 'Active nav item, wordmark', size: 'h-3 w-40' },
  { variant: 'dab', usage: 'Photo placeholder, wordmark dab', size: 'h-20 w-28' },
  { variant: 'swash', usage: 'EmptyState accent', size: 'h-8 w-56' },
];
const BRUSH_TONES: BrushstrokeTone[] = ['ocean', 'ocean-soft', 'sun', 'sun-soft'];

const ratioText = (ratio: number) => `${ratio.toFixed(2)}:1`;

function Swatch({ name, sheet, caption }: { name: string; sheet: TokenSheet; caption?: string }) {
  const hex = sheet.colors[name];
  const onSurface = contrastRatio(hex, sheet.colors.surface);
  const onCanvas = contrastRatio(hex, sheet.colors.canvas);
  return (
    <li className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="h-16 border-b border-border" style={{ backgroundColor: hex }} />
      <div className="space-y-1 p-3 text-sm">
        <p className="font-semibold text-fg">{name}</p>
        <p className="text-fg-secondary">
          <span className="tabular-nums">{hex}</span>
          {caption ? <span className="text-fg-muted"> · {caption}</span> : null}
        </p>
        <p className="text-xs tabular-nums text-fg-muted">
          {ratioText(onSurface)} on surface · {ratioText(onCanvas)} on canvas
        </p>
      </div>
    </li>
  );
}

function aliasOf(sheet: TokenSheet, name: string): string | undefined {
  return /^var\(--ws-([a-z0-9-]+)\)$/.exec(sheet.values[name] ?? '')?.[1];
}

function MotionDemo() {
  const [run, setRun] = useState(0);
  const [moved, setMoved] = useState(false);
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="font-semibold text-fg">Enter: scale-in</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          base 200ms, standard easing. Dialogs and popovers.
        </p>
        <div className="mt-4 flex h-24 items-center justify-center rounded-md bg-surface-subtle">
          <div
            key={run}
            className="animate-scale-in rounded-lg bg-surface px-4 py-3 text-sm shadow-pop"
          >
            Hold placed for 30 minutes
          </div>
        </div>
        <button type="button" className="btn-secondary mt-4" onClick={() => setRun((n) => n + 1)}>
          Replay
        </button>
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="font-semibold text-fg">State change: transition</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          slow 320ms for movement, fast 120ms for colour.
        </p>
        <div className="mt-4 flex h-24 items-center rounded-md bg-surface-subtle px-4">
          <span
            aria-hidden="true"
            className={[
              'h-8 w-8 rounded-full bg-brand transition-transform duration-slow ease-standard',
              moved ? 'translate-x-40' : 'translate-x-0',
            ].join(' ')}
          />
        </div>
        <button
          type="button"
          className="btn-secondary mt-4"
          aria-pressed={moved}
          onClick={() => setMoved((m) => !m)}
        >
          Move
        </button>
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="font-semibold text-fg">Loading: shimmer</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          Skeletons only. Static under reduced motion.
        </p>
        <div className="mt-4 space-y-3" aria-hidden="true">
          <div className="h-20 animate-shimmer rounded-md bg-linear-to-r from-surface-subtle via-canvas to-surface-subtle bg-size-[200%_100%]" />
          <div className="h-3 w-3/4 animate-shimmer rounded-sm bg-linear-to-r from-surface-subtle via-canvas to-surface-subtle bg-size-[200%_100%]" />
          <div className="h-3 w-1/2 animate-shimmer rounded-sm bg-linear-to-r from-surface-subtle via-canvas to-surface-subtle bg-size-[200%_100%]" />
        </div>
      </div>
    </div>
  );
}

export default function DesignPreviewPage() {
  const sheet = useMemo(() => parseTokens(tokensCss), []);
  const pairs = useMemo(() => checkContrastPairs(sheet), [sheet]);
  const failing = pairs.filter((p) => !p.passes).length;

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-8 pb-12 pt-14">
          <p className="text-sm font-semibold text-fg-muted">WA Stay, development build only</p>
          <h1 className="mt-3 font-display text-display-lg font-medium">Design language</h1>
          <p className="mt-4 max-w-2xl text-lg text-fg-secondary">
            The tokens, type and atoms from docs/design/design-language.md, rendered with the
            bundled fonts and the real stylesheet. Values are read from tokens.css as this page
            loads. Below them, every primitive in components/ui with its variants and states.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-16 px-8 py-14">
        <Section
          title="Palette"
          intro="Raw palette, derived from the WA mood: Indian Ocean blue, sun gold, black-swan ink and coral, with warm sand and eucalypt. Components never use these directly."
        >
          <div className="space-y-10">
            {PALETTE.map((fam) => (
              <div key={fam.family}>
                <h3 className="font-semibold text-fg">{fam.family}</h3>
                <p className="text-sm text-fg-muted">{fam.note}</p>
                <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                  {fam.tokens.map((t) => (
                    <Swatch
                      key={t}
                      name={t}
                      sheet={sheet}
                      caption={fam.decorative?.includes(t) ? 'decorative only' : undefined}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Semantic colours"
          intro="What components use. Each alias names a role and points at one palette value."
        >
          <div className="space-y-10">
            {SEMANTIC.map((g) => (
              <div key={g.group}>
                <h3 className="font-semibold text-fg">{g.group}</h3>
                <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {g.tokens.map((t) => (
                    <Swatch key={t} name={t} sheet={sheet} caption={aliasOf(sheet, t)} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Contrast pairs"
          intro={`Every pair the app relies on, computed live from tokens.css. Text needs 4.5:1, large text and UI need 3:1. ${
            failing === 0 ? 'All pairs pass.' : `${failing} failing.`
          }`}
        >
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Contrast pairs</caption>
              <thead className="border-b border-border bg-surface-subtle text-fg-secondary">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Sample
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Foreground
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Background
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Ratio
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Needs
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Result
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Usage
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pairs.map((p) => (
                  <tr key={`${p.fg}/${p.bg}`}>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex h-9 w-14 items-center justify-center rounded-md border border-border font-semibold"
                        style={{ color: p.fgHex, backgroundColor: p.bgHex }}
                      >
                        {p.kind === 'ui' ? (
                          <span
                            className="h-4 w-8 rounded-sm border-2"
                            style={{ borderColor: p.fgHex }}
                          />
                        ) : (
                          'Aa'
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{p.fg}</td>
                    <td className="px-4 py-3">{p.bg}</td>
                    <td className="px-4 py-3 tabular-nums">{ratioText(p.ratio)}</td>
                    <td className="px-4 py-3 tabular-nums text-fg-secondary">
                      {p.min}:1{' '}
                      {p.kind === 'ui' ? 'UI' : p.kind === 'large-text' ? 'large text' : 'text'}
                    </td>
                    <td className="px-4 py-3">
                      {p.passes ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-available-fg">
                          <Check size={16} aria-hidden="true" /> Pass
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-danger">
                          <X size={16} aria-hidden="true" /> Fail
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-fg-secondary">{p.usage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Type"
          intro="Figtree for everything you read and press. Fraunces only for location names, empty-state titles and the wordmark."
        >
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {TYPE_SCALE.map((t) => (
              <li
                key={t.token}
                className="grid gap-2 px-6 py-5 md:grid-cols-[10rem_1fr] md:items-baseline"
              >
                <span className="text-sm text-fg-muted">
                  <span className="font-semibold text-fg-secondary">{t.token}</span>{' '}
                  {t.display ? 'Fraunces' : 'Figtree'}
                </span>
                <span className={t.className}>{t.sample}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-fg-secondary">
            Weights: <span className="font-normal">400 body</span>,{' '}
            <span className="font-medium">500 display</span>,{' '}
            <span className="font-semibold">600 labels and headings</span>,{' '}
            <span className="font-bold">700 sparingly</span>. Numbers in tables use{' '}
            <span className="tabular-nums">tabular figures 0123456789</span>.
          </p>
        </Section>

        <Section
          title="Spacing"
          intro="A 4px grid. Space separates groups; lines are the exception."
        >
          <ul className="space-y-3">
            {SPACING.map((n) => (
              <li key={n} className="flex items-center gap-4 text-sm">
                <span className="w-24 tabular-nums text-fg-secondary">
                  {n * 4}px <span className="text-fg-muted">({n})</span>
                </span>
                <span className="h-3 rounded-sm bg-brand" style={{ width: `${n * 4}px` }} />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Radii" intro="Controls 8, cards and photos 12, dialogs 16, pills full.">
          <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
            {RADII.map((r) => (
              <li key={r} className="text-sm">
                <div className={`h-20 border border-border-strong bg-surface ${RADIUS_CLASS[r]}`} />
                <p className="mt-2 font-semibold text-fg">{r}</p>
                <p className="tabular-nums text-fg-muted">{sheet.values[`radius-${r}`]}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Elevation"
          intro="Shadows are ink at low alpha. Elevation means stacking, never decoration, and nothing glows."
        >
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {SHADOWS.map((s) => (
              <li key={s.token} className={`rounded-lg bg-surface p-5 ${s.className}`}>
                <p className="font-semibold text-fg">{s.token}</p>
                <p className="mt-1 text-sm text-fg-secondary">{s.usage}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Motion"
          intro="120, 200 and 320ms with one easing. With reduced motion requested, durations drop to zero and nothing loops."
        >
          <MotionDemo />
        </Section>

        <Section
          title="Icons"
          intro="lucide-react at stroke 1.75 and 20px, set once by LucideProvider. Icons sit beside a text label; icon-only buttons carry an accessible name."
        >
          <div className="space-y-10">
            {ICON_GROUPS.map((g) => (
              <div key={g.title}>
                <h3 className="font-semibold text-fg">{g.title}</h3>
                <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {g.icons.map(({ icon: Icon, name, meaning }) => (
                    <li
                      key={`${g.title}-${name}-${meaning}`}
                      className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    >
                      <Icon className="shrink-0 text-fg" />
                      <span>
                        <span className="block font-medium text-fg">{meaning}</span>
                        <span className="block text-xs text-fg-muted">{name}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Brushstroke"
          intro="An original hand-drawn stroke, used once per region at most, in ocean or sun only. Never behind body text, never as a button fill."
        >
          <div className="space-y-8">
            <ul className="grid gap-6 md:grid-cols-3">
              {BRUSH_VARIANTS.map((b) => (
                <li key={b.variant} className="rounded-lg border border-border bg-surface p-5">
                  <p className="font-semibold text-fg">{b.variant}</p>
                  <p className="text-sm text-fg-muted">{b.usage}</p>
                  <div className="mt-4 space-y-4">
                    {BRUSH_TONES.map((tone) => (
                      <div key={tone} className="flex items-center gap-4">
                        <Brushstroke
                          variant={b.variant}
                          tone={tone}
                          className={`${b.size} max-w-full`}
                        />
                        <span className="text-xs text-fg-muted">{tone}</span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface p-5">
                <p className="text-sm text-fg-muted">In use: active navigation item</p>
                <div className="mt-4 flex gap-8 text-sm">
                  <span className="relative pb-2 font-semibold text-fg">
                    Explore
                    <Brushstroke
                      variant="underline"
                      className="absolute inset-x-0 -bottom-0.5 h-1.5 w-full"
                    />
                  </span>
                  <span className="pb-2 text-fg-secondary">Watches</span>
                  <span className="pb-2 text-fg-secondary">Bookings</span>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface p-5">
                <p className="text-sm text-fg-muted">In use: empty-state accent</p>
                <div className="mt-4 flex flex-col items-center text-center">
                  <Brushstroke variant="swash" tone="sun" className="h-5 w-32" />
                  <p className="mt-3 font-display text-display-sm font-medium text-fg">
                    No watches yet
                  </p>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Pick a place and dates, and WA Stay checks for openings every few minutes.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section
          title="Photo placeholder"
          intro="Shown when a provider has no photo, or a photo fails to load. The name says what is missing."
        >
          <div className="grid gap-6 md:grid-cols-[1fr_1fr_2fr]">
            <div className="aspect-4/3 overflow-hidden rounded-lg">
              <PhotoPlaceholder kind="campground" aria-label="No photo available for Lucky Bay" />
            </div>
            <div className="aspect-4/3 overflow-hidden rounded-lg">
              <PhotoPlaceholder
                kind="farm-stay"
                aria-label="No photo available for Wildflower Farm"
              />
            </div>
            <div className="aspect-video overflow-hidden rounded-xl">
              <PhotoPlaceholder
                kind="caravan-park"
                size="hero"
                aria-label="No photo available for Coral Bay"
              />
            </div>
          </div>
        </Section>

        <Section
          title="Brand"
          intro="The WA Stay logo as the Logo component renders it. The artwork is generated by npm run icons (resources/brand). The mark never goes below 16 px, the lockup never below 96 px wide."
        >
          <div className="grid gap-6 md:grid-cols-3">
            <figure className="rounded-lg border border-border bg-surface p-6">
              <Logo variant="lockup" className="h-12 w-auto" />
              <figcaption className="mt-4 text-sm text-fg-muted">Lockup on surface</figcaption>
            </figure>
            <figure className="rounded-lg border border-border bg-canvas p-6">
              <div className="flex items-end gap-4">
                <Logo variant="mark" className="h-16 w-16" />
                <Logo variant="mark" className="h-8 w-8" />
                <Logo variant="lockup" className="h-auto w-24" />
              </div>
              <figcaption className="mt-4 text-sm text-fg-muted">
                Mark at 64 and 32 px, lockup at its 96 px minimum width, on canvas
              </figcaption>
            </figure>
            <figure className="rounded-lg bg-brand p-6">
              <span
                aria-hidden="true"
                className="block h-16 w-16 bg-fg-inverse"
                style={{
                  WebkitMaskImage: `url(${markMonoUrl})`,
                  maskImage: `url(${markMonoUrl})`,
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                }}
              />
              <figcaption className="mt-4 text-sm text-fg-inverse">
                Mono mark in fg-inverse, reversed on brand
              </figcaption>
            </figure>
          </div>
        </Section>

        <Section
          title="Focus and legacy controls"
          intro="Tab through these. Every control shows the same 2px ocean focus ring. The legacy classes keep old pages consistent until they are rebuilt."
        >
          <div className="card max-w-2xl space-y-5">
            <div>
              <label
                htmlFor="design-preview-place"
                className="mb-1 block text-sm font-semibold text-fg"
              >
                Where to
              </label>
              <input
                id="design-preview-place"
                className="input"
                placeholder="Search places, parks or towns"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn-primary">
                <Search size={18} aria-hidden="true" /> Search
              </button>
              <button type="button" className="btn-secondary">
                Cancel
              </button>
              <button type="button" className="btn-danger">
                Delete watch
              </button>
              <button type="button" className="btn-primary" disabled>
                Disabled
              </button>
            </div>
            <p className="text-sm text-fg-secondary">
              Links use brand-strong:{' '}
              <a
                className="font-semibold text-brand-strong underline underline-offset-2"
                href="#/__design"
              >
                Read the booking rules
              </a>
            </p>
          </div>
        </Section>

        <ComponentGallery />
      </main>
    </div>
  );
}
