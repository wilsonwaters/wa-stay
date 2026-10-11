/**
 * Hides Node's module-hook registrars from code loaded after this module, in this test file.
 *
 * Jest 30's sandboxed `module` makes `module.register()` and `module.registerHooks()` throw:
 * a hook would attach to the loader running Jest itself. `@tailwindcss/node` registers one when
 * it loads, only to reload JavaScript configs and plugins (`@config`, `@plugin`), which the
 * stylesheet does not use. With both registrars `undefined` it skips the hook.
 *
 * They are set to `undefined`, not deleted: Jest's class extends Node's own `Module`, so a
 * deleted property would expose the real registrars again.
 */
import Module from 'module';

const registrars = Module as unknown as { register?: unknown; registerHooks?: unknown };
registrars.register = undefined;
registrars.registerHooks = undefined;
