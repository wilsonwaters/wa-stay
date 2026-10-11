import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import {
  BROWSE_ONLY_MANIFEST,
  FAKE_MANIFEST,
  PARKSTAY_MANIFEST,
  fail,
  ok,
} from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { ProviderPicker } from './ProviderPicker';

function Picker({
  onChange = jest.fn(),
  anyProvider = false,
}: {
  onChange?: (id: string) => void;
  /** No capability: every provider. */
  anyProvider?: boolean;
}) {
  const [value, setValue] = useState<string>();
  return (
    <ProviderPicker
      capability={anyProvider ? undefined : 'watches'}
      label="Provider"
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
      emptyMessage="No provider supports watches yet"
    />
  );
}

const providers = (list: unknown[]) => ({
  providers: { list: jest.fn().mockResolvedValue(ok(list)) },
});

describe('ProviderPicker', () => {
  it('lists only providers with the capability', async () => {
    renderWithProviders(<Picker />, {
      api: providers([PARKSTAY_MANIFEST, BROWSE_ONLY_MANIFEST, FAKE_MANIFEST]),
    });
    const group = await screen.findByRole('radiogroup', { name: 'Provider' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'ParkStay WA' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Fake Stay Holidays' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Browse Only' })).toBeNull();
  });

  it('lists every provider when the flow needs no capability', async () => {
    renderWithProviders(<Picker anyProvider />, {
      api: providers([PARKSTAY_MANIFEST, BROWSE_ONLY_MANIFEST, FAKE_MANIFEST]),
    });
    await screen.findByRole('radiogroup', { name: 'Provider' });
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      'parkstay',
      'browseonly',
      'fakestay',
    ]);
  });

  it('pre-selects a single qualifying provider, still showing it', async () => {
    const onChange = jest.fn();
    renderWithProviders(<Picker onChange={onChange} />, {
      api: providers([PARKSTAY_MANIFEST, BROWSE_ONLY_MANIFEST]),
    });
    const radio = await screen.findByRole('radio', { name: 'ParkStay WA' });
    await waitFor(() => expect(radio).toBeChecked());
    expect(onChange).toHaveBeenCalledWith('parkstay');
    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });

  it('says so when no provider offers the capability', async () => {
    renderWithProviders(<Picker />, { api: providers([BROWSE_ONLY_MANIFEST]) });
    expect(await screen.findByText('No provider supports watches yet')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('offers a retry when the providers cannot be loaded', async () => {
    const list = jest
      .fn()
      .mockResolvedValueOnce(fail('Main is busy'))
      .mockResolvedValueOnce(fail('Main is busy'))
      .mockResolvedValue(ok([PARKSTAY_MANIFEST]));
    const { user } = renderWithProviders(<Picker />, { api: { providers: { list } } });
    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 });
    expect(screen.getByText("Providers couldn't be loaded")).toBeInTheDocument();
    await user.click(retry);
    expect(await screen.findByRole('radio', { name: 'ParkStay WA' })).toBeInTheDocument();
  });
});
