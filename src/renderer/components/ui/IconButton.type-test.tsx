/**
 * IconButton's `label` is required at the type level. `npm run type-check` checks this file
 * (`tsconfig.renderer.json`): with a label it compiles, and without one the
 * `@ts-expect-error` below is satisfied only while `label` stays required. It is not bundled
 * (nothing imports it) and not a Jest test: type-checking in a Jest worker built a whole
 * TypeScript program there, which the macOS runner's Node crashed on more than once.
 */
import { IconButton } from './IconButton';

export const withLabel = <IconButton label="Close" icon={null} />;

// @ts-expect-error `label` is required: an icon-only button needs an accessible name.
export const withoutLabel = <IconButton icon={null} />;
