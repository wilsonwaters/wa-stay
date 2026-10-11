/**
 * A provider manifest as the app keeps it: parsed by `ProviderManifestSchema` (so fields
 * the schema does not know are dropped) and deeply frozen, so nothing can change what the
 * registry validated.
 */

import { ProviderManifestSchema, type ProviderManifest } from '@shared/types/provider.types';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export type ManifestParseResult =
  { ok: true; manifest: Readonly<ProviderManifest> } | { ok: false; issues: string[] };

/** Parses and freezes a manifest; `issues` are `path: message` lines when it is invalid. */
export function parseProviderManifest(manifest: unknown): ManifestParseResult {
  const parsed = ProviderManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (i) => `${i.path.length ? i.path.join('.') : 'manifest'}: ${i.message}`
      ),
    };
  }
  return { ok: true, manifest: deepFreeze(parsed.data) };
}

/** Like `parseProviderManifest`, but throws the `ZodError` for an invalid manifest. */
export function freezeProviderManifest(manifest: ProviderManifest): Readonly<ProviderManifest> {
  return deepFreeze(ProviderManifestSchema.parse(manifest));
}
