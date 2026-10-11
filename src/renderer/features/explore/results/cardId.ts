/** The DOM id of a location's card in Explore's list, so the map can scroll it into view or focus it. */
export function cardId(key: string): string {
  return `place-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}
