/**
 * What the update card shows, from the `updater:*` events and the person's choices. Pure, so
 * the rules are tested without a renderer:
 * - "Later" and "Dismiss" hide the card for the state it was showing; a later event re-shows
 *   it only for something new (available → downloaded, or a newer version);
 * - a download error mid-way switches the card to the error state.
 */

export type UpdateView =
  | { state: 'idle' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version?: string; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

export interface UpdateCardState {
  view: UpdateView;
  /** The view the person set aside (`viewKey`), until something new arrives. */
  dismissed: string | null;
}

export type UpdateAction =
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }
  /** The person pressed Download. */
  | { type: 'download' }
  /** Later, Dismiss or the close button. */
  | { type: 'dismiss' };

export const INITIAL_UPDATE_STATE: UpdateCardState = { view: { state: 'idle' }, dismissed: null };

/** Two views with the same key are the same news. */
export function viewKey(view: UpdateView): string {
  switch (view.state) {
    case 'available':
    case 'downloaded':
      return `${view.state}:${view.version}`;
    case 'error':
      return `error:${view.message}`;
    default:
      return view.state;
  }
}

function versionOf(view: UpdateView): string | undefined {
  return 'version' in view ? view.version : undefined;
}

function clampPercent(percent: number): number {
  return Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : 0;
}

export function updateReducer(current: UpdateCardState, action: UpdateAction): UpdateCardState {
  const show = (view: UpdateView): UpdateCardState => ({ ...current, view });
  switch (action.type) {
    case 'available':
      return show({ state: 'available', version: action.version });
    case 'not-available':
      return show({ state: 'idle' });
    case 'progress':
      return show({
        state: 'downloading',
        version: versionOf(current.view),
        percent: clampPercent(action.percent),
      });
    case 'downloaded':
      return show({ state: 'downloaded', version: action.version });
    case 'error':
      return show({ state: 'error', message: action.message });
    case 'download':
      return {
        view: { state: 'downloading', version: versionOf(current.view), percent: 0 },
        dismissed: null,
      };
    case 'dismiss':
      return { ...current, dismissed: viewKey(current.view) };
  }
}

/** The card is on screen unless it is idle or the person set this exact news aside. */
export function isUpdateCardShown({ view, dismissed }: UpdateCardState): boolean {
  return view.state !== 'idle' && viewKey(view) !== dismissed;
}
