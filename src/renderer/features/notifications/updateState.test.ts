import {
  INITIAL_UPDATE_STATE,
  isUpdateCardShown,
  updateReducer,
  type UpdateAction,
  type UpdateCardState,
} from './updateState';

const run = (...actions: UpdateAction[]): UpdateCardState =>
  actions.reduce(updateReducer, INITIAL_UPDATE_STATE);

describe('updateReducer', () => {
  it('follows available → download → progress → downloaded', () => {
    let state = run({ type: 'available', version: '2.1.0' });
    expect(state.view).toEqual({ state: 'available', version: '2.1.0' });
    state = updateReducer(state, { type: 'download' });
    expect(state.view).toEqual({ state: 'downloading', version: '2.1.0', percent: 0 });
    state = updateReducer(state, { type: 'progress', percent: 42.4 });
    expect(state.view).toEqual({ state: 'downloading', version: '2.1.0', percent: 42 });
    state = updateReducer(state, { type: 'downloaded', version: '2.1.0' });
    expect(state.view).toEqual({ state: 'downloaded', version: '2.1.0' });
    expect(isUpdateCardShown(state)).toBe(true);
  });

  it('after Later, the same news stays hidden and new news shows again', () => {
    const later = run({ type: 'available', version: '2.1.0' }, { type: 'dismiss' });
    expect(isUpdateCardShown(later)).toBe(false);
    expect(isUpdateCardShown(updateReducer(later, { type: 'available', version: '2.1.0' }))).toBe(
      false
    );
    expect(isUpdateCardShown(updateReducer(later, { type: 'downloaded', version: '2.1.0' }))).toBe(
      true
    );
    expect(isUpdateCardShown(updateReducer(later, { type: 'available', version: '2.2.0' }))).toBe(
      true
    );
  });

  it('a download error mid-way switches to the error state', () => {
    const state = run(
      { type: 'available', version: '2.1.0' },
      { type: 'download' },
      { type: 'progress', percent: 30 },
      { type: 'error', message: 'net::ERR_CONNECTION_RESET' }
    );
    expect(state.view).toEqual({ state: 'error', message: 'net::ERR_CONNECTION_RESET' });
    expect(isUpdateCardShown(state)).toBe(true);
  });

  it('is hidden while idle, and keeps progress within 0–100', () => {
    expect(isUpdateCardShown(INITIAL_UPDATE_STATE)).toBe(false);
    expect(
      isUpdateCardShown(run({ type: 'available', version: '2' }, { type: 'not-available' }))
    ).toBe(false);
    expect(run({ type: 'progress', percent: 140 }).view).toMatchObject({ percent: 100 });
    expect(run({ type: 'progress', percent: Number.NaN }).view).toMatchObject({ percent: 0 });
  });
});
