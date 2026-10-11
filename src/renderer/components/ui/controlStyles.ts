/** Shared look for text-like controls: border-strong edge (3.92:1), crimson when invalid. */
export const CONTROL_CLASS = [
  'block w-full rounded-md border border-border-strong bg-surface text-base text-fg',
  'transition-colors duration-fast ease-standard',
  'not-disabled:hover:border-fg-secondary',
  'disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-fg-muted',
  'aria-invalid:border-danger',
].join(' ');
