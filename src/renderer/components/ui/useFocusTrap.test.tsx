import { useRef, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getTabbables, useFocusTrap } from './useFocusTrap';

function Trap({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, { active });
  return (
    <>
      <button type="button" onClick={() => setActive(true)}>
        Open
      </button>
      <div ref={ref} tabIndex={-1} hidden={!active}>
        {children}
        <button type="button" onClick={() => setActive(false)}>
          Done
        </button>
      </div>
      <button type="button">Outside</button>
    </>
  );
}

describe('useFocusTrap', () => {
  it('moves focus in, cycles Tab and Shift+Tab inside, and returns focus on deactivation', async () => {
    const user = userEvent.setup();
    render(
      <Trap>
        <input aria-label="First" />
        <button type="button" disabled>
          Disabled
        </button>
        <span tabIndex={-1}>Not tabbable</span>
      </Trap>
    );
    const open = screen.getByRole('button', { name: 'Open' });
    await user.click(open);
    const first = screen.getByRole('textbox', { name: 'First' });
    const done = screen.getByRole('button', { name: 'Done' });
    expect(first).toHaveFocus();

    await user.tab();
    expect(done).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(done).toHaveFocus();

    await user.click(done);
    expect(open).toHaveFocus();
  });

  it('skips controls that are not visible or sit in a disabled fieldset', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <button>Visible</button>
      <button style="display: none">Display none</button>
      <div style="display: none"><button>Inside display none</button></div>
      <button style="visibility: hidden">Visibility hidden</button>
      <div style="visibility: hidden"><a href="#x">Inherits hidden</a></div>
      <div style="visibility: hidden"><a href="#y" style="visibility: visible">Shown again</a></div>
      <fieldset disabled>
        <legend><button>In the legend</button></legend>
        <input aria-label="Disabled by fieldset" />
        <select aria-label="Also disabled"><option>One</option></select>
      </fieldset>
      <a href="#z">Last</a>
    `;
    document.body.appendChild(container);
    const names = getTabbables(container).map(
      (el) => el.getAttribute('aria-label') ?? el.textContent
    );
    expect(names).toEqual(['Visible', 'Shown again', 'In the legend', 'Last']);
    container.remove();
  });

  it('with layout, skips a zero-size control that has no boxes', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 } as DOMRect;
    const spy = jest.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (
      this: Element
    ) {
      return (this.hasAttribute('data-no-box') ? [] : [rect]) as unknown as DOMRectList;
    });
    const container = document.createElement('div');
    container.innerHTML = `
      <button>Shown</button>
      <button data-no-box>Collapsed</button>
      <button>Also shown</button>
    `;
    document.body.appendChild(container);
    expect(getTabbables(container).map((el) => el.textContent)).toEqual(['Shown', 'Also shown']);
    container.remove();
    spy.mockRestore();
  });

  it('brings focus back in when it fell to the body: Tab goes to the first, Shift+Tab to the last', async () => {
    const user = userEvent.setup();
    render(
      <Trap>
        <input aria-label="First" />
      </Trap>
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const first = screen.getByRole('textbox', { name: 'First' });
    const done = screen.getByRole('button', { name: 'Done' });
    expect(first).toHaveFocus();

    act(() => first.blur());
    expect(document.body).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();

    act(() => first.blur());
    await user.tab({ shift: true });
    expect(done).toHaveFocus();
  });

  it('leaves focus alone in another layer outside the trap, such as a toast', async () => {
    const user = userEvent.setup();
    render(
      <Trap>
        <input aria-label="First" />
      </Trap>
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const outside = screen.getByRole('button', { name: 'Outside' });
    act(() => outside.focus());
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    outside.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(outside).toHaveFocus();
  });

  it('treats a radio group as one tab stop: the checked radio, else the first', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <input type="radio" name="kind" value="a" />
      <input type="radio" name="kind" value="b" checked />
      <input type="radio" name="size" value="s" />
      <input type="radio" name="size" value="m" />
      <a href="#x">Link</a>
      <div hidden><button>Hidden</button></div>
      <button tabindex="-1">Skipped</button>
    `;
    const values = getTabbables(container).map(
      (el) => (el as HTMLInputElement).value || el.textContent
    );
    expect(values).toEqual(['b', 's', 'Link']);
  });
});
