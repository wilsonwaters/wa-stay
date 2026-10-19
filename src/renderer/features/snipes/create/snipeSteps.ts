/** Which of the new-snipe form's fields each step checks before moving on (pure). */
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { snipeStayFields, type SnipeFieldName, type SnipeStepId } from './snipeForm';

/** The fields each step checks before moving on. */
export function stepFields(
  step: SnipeStepId,
  manifest: ProviderManifest | undefined
): SnipeFieldName[] {
  switch (step) {
    case 'provider':
      return ['providerId'];
    case 'location':
      return ['location'];
    case 'stay':
      return [
        'arrival',
        'departure',
        'adults',
        ...snipeStayFields(manifest).map((field) => `stayParams.${field.key}` as const),
      ];
    case 'release':
      return [
        'releaseMode',
        'releaseDate',
        'action',
        'leadTimeSeconds',
        'pollIntervalSeconds',
        'windowMinutes',
        'maxAttempts',
      ];
    default:
      return ['name', 'notes'];
  }
}
