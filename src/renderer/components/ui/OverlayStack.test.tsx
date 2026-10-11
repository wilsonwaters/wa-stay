import { OverlayStack } from './OverlayStack';

describe('OverlayStack', () => {
  let stack: OverlayStack;
  let root: HTMLElement;
  const entry = (modal: boolean, onEscape?: () => void, element: HTMLElement | null = null) => ({
    modal,
    element: () => element,
    handlesEscape: () => Boolean(onEscape),
    onEscape: () => onEscape?.(),
  });
  const escape = () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  beforeEach(() => {
    root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    stack = new OverlayStack(document);
  });
  afterEach(() => root.remove());

  it('makes #root inert only while a modal is open', () => {
    const popover = stack.push(entry(false));
    expect(root).not.toHaveAttribute('inert');
    const dialog = stack.push(entry(true));
    expect(root).toHaveAttribute('inert');
    dialog();
    expect(root).not.toHaveAttribute('inert');
    popover();
  });

  it('sends Escape to the top overlay only', () => {
    const lower = jest.fn();
    const upper = jest.fn();
    const removeLower = stack.push(entry(true, lower));
    const removeUpper = stack.push(entry(false, upper));
    escape();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    removeUpper();
    escape();
    expect(lower).toHaveBeenCalledTimes(1);
    removeLower();
    escape();
    expect(lower).toHaveBeenCalledTimes(1);
  });

  it('does not pass Escape down when the top overlay ignores it', () => {
    const lower = jest.fn();
    const removeLower = stack.push(entry(true, lower));
    const removeTop = stack.push(entry(true));
    escape();
    expect(lower).not.toHaveBeenCalled();
    removeTop();
    removeLower();
  });

  it('makes overlays below the top modal inert, and restores them', () => {
    const lowerEl = document.createElement('div');
    const removeLower = stack.push(entry(true, undefined, lowerEl));
    expect(lowerEl).not.toHaveAttribute('inert');
    const removeTop = stack.push(entry(true));
    expect(lowerEl).toHaveAttribute('inert');
    removeTop();
    expect(lowerEl).not.toHaveAttribute('inert');
    expect(root).toHaveAttribute('inert');
    removeLower();
  });

  it('locks page scroll while a modal is open and restores the previous value', () => {
    document.body.style.overflow = 'scroll';
    const remove = stack.push(entry(true));
    expect(document.body.style.overflow).toBe('hidden');
    remove();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });
});
