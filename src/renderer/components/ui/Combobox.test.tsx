import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox, type ComboboxOption } from './Combobox';

const PLACES: ComboboxOption[] = [
  { value: 'lucky-bay', label: 'Lucky Bay', description: 'Cape Le Grand', group: 'Campgrounds' },
  {
    value: 'le-grand',
    label: 'Le Grand Beach',
    description: 'Cape Le Grand',
    group: 'Campgrounds',
  },
  { value: 'cape-le-grand', label: 'Cape Le Grand National Park', group: 'Parks' },
  { value: 'esperance', label: 'Esperance', group: 'Towns', disabled: true },
];

function Where({ onChange = jest.fn() }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <>
      <Combobox
        label="Where to"
        options={PLACES}
        value={value}
        onChange={(next, option) => {
          setValue(next);
          onChange(next, option);
        }}
        placeholder="Places, parks or towns"
      />
      <p>Chosen: {value ?? 'none'}</p>
    </>
  );
}

const input = () => screen.getByRole('combobox', { name: 'Where to' });
const listbox = () => screen.getByRole('listbox', { name: 'Where to' });

describe('Combobox', () => {
  it('has the ARIA 1.2 combobox attributes', () => {
    render(<Where />);
    expect(input()).toHaveAttribute('aria-autocomplete', 'list');
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(input()).toHaveAttribute(
      'aria-controls',
      screen.getByRole('listbox', { hidden: true }).id
    );
    expect(input()).not.toHaveAttribute('aria-activedescendant');
  });

  it('filters options as you type, and ↓ then Enter selects', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<Where onChange={onChange} />);
    await user.type(input(), 'lucky');
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(listbox())
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Lucky BayCape Le Grand']);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('lucky-bay', PLACES[0]);
    expect(input()).toHaveValue('Lucky Bay');
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Chosen: lucky-bay')).toBeInTheDocument();
  });

  it('tracks the highlighted option with aria-activedescendant and aria-selected', async () => {
    const user = userEvent.setup();
    render(<Where />);
    await user.type(input(), 'grand');
    // Matches labels only: "Lucky Bay" (Cape Le Grand in its description) is filtered out.
    const options = within(listbox()).getAllByRole('option');
    expect(options.map((o) => o.id)).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Le Grand Beach');

    await user.keyboard('{ArrowDown}');
    expect(input()).toHaveAttribute('aria-activedescendant', options[0].id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(input()).toHaveAttribute('aria-activedescendant', options[1].id);
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(input()).toHaveAttribute('aria-activedescendant', options[0].id);
    await user.keyboard('{ArrowUp}');
    expect(input()).toHaveAttribute('aria-activedescendant', options[1].id);
    // Focus never leaves the input.
    expect(input()).toHaveFocus();
  });

  it('groups options under labelled groups and skips disabled ones', async () => {
    const user = userEvent.setup();
    render(<Where />);
    await user.click(input());
    expect(within(listbox()).getByRole('group', { name: 'Campgrounds' })).toBeInTheDocument();
    expect(within(listbox()).getByRole('group', { name: 'Parks' })).toBeInTheDocument();
    const esperance = within(listbox()).getByRole('option', { name: /Esperance/ });
    expect(esperance).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{ArrowUp}');
    expect(input()).toHaveAttribute(
      'aria-activedescendant',
      within(listbox()).getByRole('option', { name: /Cape Le Grand National Park/ }).id
    );
  });

  it('shows a "No matches" row', async () => {
    render(<Where />);
    await userEvent.type(input(), 'zzz');
    const empty = within(listbox()).getByRole('option', { name: 'No matches' });
    expect(empty).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(input()).not.toHaveAttribute('aria-activedescendant');
  });

  it('Escape closes the list, and a second Escape clears', async () => {
    const user = userEvent.setup();
    render(<Where />);
    await user.type(input(), 'lucky');
    await user.keyboard('{ArrowDown}{Enter}');
    await user.keyboard('{ArrowDown}');
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(input()).toHaveValue('Lucky Bay');
    await user.keyboard('{Escape}');
    expect(input()).toHaveValue('');
    expect(screen.getByText('Chosen: none')).toBeInTheDocument();
  });

  it('Tab closes the list without choosing', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<Where onChange={onChange} />);
    await user.type(input(), 'lucky');
    await user.keyboard('{ArrowDown}');
    await user.tab();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('chooses an option by click', async () => {
    const user = userEvent.setup();
    render(<Where />);
    await user.click(input());
    await user.click(within(listbox()).getByRole('option', { name: /Le Grand Beach/ }));
    expect(input()).toHaveValue('Le Grand Beach');
    expect(input()).toHaveFocus();
  });

  it('renders the segment appearance with its small label', () => {
    render(<Combobox label="Where" options={PLACES} appearance="segment" />);
    const box = screen.getByRole('combobox', { name: 'Where' });
    expect(box).not.toHaveAttribute('aria-describedby');
    expect(box).not.toHaveAttribute('aria-invalid');
  });

  it('in a segment, describes the input with a hidden hint and a visible error, every id rendered', () => {
    render(
      <Combobox
        label="Where"
        options={PLACES}
        appearance="segment"
        hint="Start typing a place"
        error="Choose a place from the list"
      />
    );
    const box = screen.getByRole('combobox', { name: 'Where' });
    const ids = (box.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(document.getElementById(id)).toBeInTheDocument();
    expect(box).toHaveAccessibleDescription('Start typing a place Choose a place from the list');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Choose a place from the list')).toBeVisible();
  });

  describe('the list height', () => {
    const innerHeight = window.innerHeight;
    afterEach(() => {
      jest.restoreAllMocks();
      Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
    });

    /** Opens the list under an input whose box ends 143 px down a window `height` px high. */
    async function openIn(height: number) {
      Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
      jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        top: 87,
        left: 16,
        width: 400,
        height: 56,
        bottom: 143,
        right: 416,
      } as DOMRect);
      const user = userEvent.setup();
      render(<Where />);
      await user.click(input());
      return listbox();
    }

    it('is up to 30rem, room for 8 two-line suggestions at the 640 px minimum window', async () => {
      // 640 − 143 − 4 (offset) − 8 (edge) = 485 px of room: the 480 px cap applies
      expect((await openIn(640)).style.maxHeight).toBe('480px');
    });

    it('is never taller than the room on its side, so it never covers its input', async () => {
      // A window framed down to 589 px of page: 434 px of room
      expect((await openIn(589)).style.maxHeight).toBe('434px');
    });
  });

  it('describes the field with its hint and error', () => {
    render(
      <Combobox
        label="Campground"
        options={PLACES}
        hint="Start typing a name"
        error="Choose a campground"
      />
    );
    const box = screen.getByRole('combobox', { name: 'Campground' });
    expect(box).toHaveAccessibleDescription('Start typing a name Choose a campground');
    expect(box).toHaveAttribute('aria-invalid', 'true');
  });
});
