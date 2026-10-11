/**
 * A provider's own stay fields (architecture-notes §12.1, §12.31): the values a watch or
 * snipe keeps in `stayParams`, checked in main against `manifest.stayFields`.
 *
 * - Defaults: a field that applies to the use and has a `default` is filled in when absent
 *   (ParkStay: `gearType: 'all'`, `numVehicles: 1`).
 * - Validation of the declared keys: type, select options, number range, text pattern, and
 *   `required` for the fields that apply. Each problem is an issue `stayParams.<key>`.
 * - Keys the provider does not declare pass through untouched (legacy rows carry `parkId`).
 */

import type {
  ProviderManifest,
  StayFieldDescriptor,
  StayFieldUse,
  StayParams,
} from '@shared/types/provider.types';
import { stayFieldProblem } from '@shared/utils/stay-fields';
import { AppError } from '../utils/app-error';

/**
 * The stay params with the provider's defaults filled in for `uses`, after checking every
 * declared key. Throws `AppError('VALIDATION')` with issues `stayParams.<key>`.
 */
export function resolveStayParams(
  manifest: Pick<ProviderManifest, 'stayFields'>,
  uses: readonly StayFieldUse[],
  params: StayParams = {}
): StayParams {
  const fields = manifest.stayFields ?? [];
  const applies = (field: StayFieldDescriptor): boolean =>
    field.appliesTo.some((use) => uses.includes(use));

  const resolved: StayParams = { ...params };
  for (const field of fields) {
    if (applies(field) && resolved[field.key] === undefined && field.default !== undefined) {
      resolved[field.key] = field.default;
    }
  }

  const issues: string[] = [];
  const messages: string[] = [];
  for (const field of fields) {
    const value = resolved[field.key];
    const problem =
      value === undefined
        ? applies(field) && field.required
          ? `${field.label} is required`
          : undefined
        : stayFieldProblem(field, value);
    if (problem) {
      issues.push(`stayParams.${field.key}`);
      messages.push(problem);
    }
  }
  if (issues.length > 0) {
    throw new AppError('VALIDATION', messages.join('; '), { issues });
  }
  return resolved;
}
