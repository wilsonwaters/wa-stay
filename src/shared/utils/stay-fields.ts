/**
 * Checks one value of a provider's stay field against its descriptor (architecture-notes
 * §12.1): select options, number range, text pattern and type. Pure, so main
 * (`core/stay-params.ts`) and the renderer's forms validate with the same rules and words.
 *
 * No node or electron imports: the renderer compiles this file too.
 */

import type { StayFieldDescriptor } from '../types/provider.types';

/** Why a declared field's value is wrong, or undefined when it is fine. */
export function stayFieldProblem(field: StayFieldDescriptor, value: unknown): string | undefined {
  switch (field.type) {
    case 'select':
      if (typeof value !== 'string') return `${field.label} must be one of the listed options`;
      if (field.options && !field.options.some((option) => option.value === value)) {
        return `${field.label} must be one of ${field.options.map((o) => o.label).join(', ')}`;
      }
      return undefined;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `${field.label} must be a number`;
      }
      if (field.min !== undefined && value < field.min) {
        return `${field.label} must be at least ${field.min}`;
      }
      if (field.max !== undefined && value > field.max) {
        return `${field.label} must be at most ${field.max}`;
      }
      return undefined;
    case 'text':
      if (typeof value !== 'string') return `${field.label} must be text`;
      if (field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(value)) {
        return `${field.label} is not in the expected format`;
      }
      return undefined;
    case 'boolean':
      return typeof value === 'boolean' ? undefined : `${field.label} must be yes or no`;
    default:
      return undefined;
  }
}
