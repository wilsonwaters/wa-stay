import { cx } from './ui/cx';

export interface RichTextProps {
  /**
   * HTML that main has already sanitised (`sanitizeProviderHtml`): only simple text structure,
   * https links with `target="_blank"`, and https images. Never pass anything else.
   */
  html: string;
  className?: string;
}

/** Styles for the few tags a sanitised description can hold, scoped to this block. */
const PROSE = cx(
  'max-w-2xl text-base text-fg-secondary',
  '[&>*+*]:mt-3 [&_li+li]:mt-1',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_strong]:font-semibold [&_strong]:text-fg [&_em]:italic',
  '[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-fg [&_h4]:font-semibold [&_h4]:text-fg',
  '[&_h5]:font-semibold [&_h5]:text-fg [&_h6]:font-semibold [&_h6]:text-fg',
  '[&_a]:rounded-sm [&_a]:font-semibold [&_a]:text-brand-strong [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-fg',
  '[&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg',
  '[&_hr]:border-border'
);

/**
 * A provider's description, formatted. The HTML is main's sanitised copy (architecture-notes
 * §3); the renderer never cleans HTML itself. Its links open in the system browser: main gives
 * each one `target="_blank"`, which the app window hands to the browser.
 */
export function RichText({ html, className }: RichTextProps) {
  return <div className={cx(PROSE, className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

export default RichText;
