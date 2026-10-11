/**
 * WA Stay brand colours for HTML that the renderer's CSS never reaches: notification emails
 * and the Gmail sign-in page. Each value is an exact D1 palette colour from
 * `src/renderer/styles/tokens.css` (named in the comment), and a test pins them to the
 * tokens and checks every text and background pair below for WCAG AA.
 *
 * Ink is for text. Coral (`accent`) is only for the one button, as in the app.
 */
export const BRAND_COLORS = {
  /** `fg` (ink-900): headings and body text. */
  text: '#15181D',
  /** `fg-secondary` (ink-700): descriptions. */
  textSecondary: '#3A3F47',
  /** `fg-muted` (sand-600): footers and small print. */
  textMuted: '#6B6256',
  /** `brand-strong` (ocean-700): links and the location line. */
  link: '#214C82',
  /** `canvas` (sand-50): the page behind the card. */
  canvas: '#FAF7F2',
  /** `surface` (sand-0): the card. */
  surface: '#FFFFFF',
  /** `border` (sand-200): hairlines. */
  border: '#E6DED2',
  /** `ocean-500`: the brushstroke blue, as the rule under the wordmark. Decorative. */
  ocean: '#3A74B8',
  /** `accent` (coral-600): the call-to-action button. */
  accent: '#BF4520',
  /** `accent-fg` (sand-0): the label on the button. */
  accentText: '#FFFFFF',
} as const;
