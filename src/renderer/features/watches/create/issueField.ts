import type { WatchFieldName } from '../form/watchFormSchema';

const TOP_LEVEL: readonly string[] = [
  'providerId',
  'name',
  'unitIds',
  'checkIntervalMinutes',
  'autoHold',
  'notifyOnly',
  'allowPartialMatch',
  'maxPrice',
  'notes',
];

/** The form field a `VALIDATION` issue path from main names (`stay.arrival` → `arrival`). */
export function issueField(path: string): WatchFieldName | undefined {
  if (path.startsWith('location')) return 'location';
  if (path.startsWith('stay.')) {
    const key = path.slice('stay.'.length);
    return key === 'arrival' || key === 'departure' || key === 'adults' ? key : 'arrival';
  }
  if (/^stayParams\.[A-Za-z][A-Za-z0-9]*$/.test(path)) return path as WatchFieldName;
  return TOP_LEVEL.includes(path) ? (path as WatchFieldName) : undefined;
}
