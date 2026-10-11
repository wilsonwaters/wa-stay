import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tab, TabList, TabPanel, Tabs } from './Tabs';

function Details({ onValueChange = jest.fn() }) {
  return (
    <Tabs defaultValue="overview" onValueChange={onValueChange}>
      <TabList aria-label="Location details">
        <Tab value="overview">Overview</Tab>
        <Tab value="sites">Sites</Tab>
        <Tab value="rules">Booking rules</Tab>
      </TabList>
      <TabPanel value="overview">Camp among the peppermint trees.</TabPanel>
      <TabPanel value="sites">24 sites</TabPanel>
      <TabPanel value="rules">Opens 180 days ahead.</TabPanel>
    </Tabs>
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('Tabs', () => {
  it('wires tablist, tabs and panels together', () => {
    render(<Details />);
    expect(screen.getByRole('tablist', { name: 'Location details' })).toBeInTheDocument();
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel', { name: 'Overview' });
    expect(tab('Overview')).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveTextContent('Camp among the peppermint trees.');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('arrow keys move the selection (automatic activation) and aria-selected follows', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    render(<Details onValueChange={onValueChange} />);
    await user.tab();
    expect(tab('Overview')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Sites')).toHaveFocus();
    expect(tab('Sites')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel', { name: 'Sites' })).toHaveTextContent('24 sites');
    expect(onValueChange).toHaveBeenLastCalledWith('sites');

    await user.keyboard('{End}');
    expect(tab('Booking rules')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(tab('Booking rules')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
  });

  it('puts only the selected tab in the tab order', async () => {
    const user = userEvent.setup();
    render(<Details />);
    expect(tab('Overview')).toHaveAttribute('tabindex', '0');
    expect(tab('Sites')).toHaveAttribute('tabindex', '-1');
    expect(tab('Booking rules')).toHaveAttribute('tabindex', '-1');
    await user.tab();
    await user.tab();
    // Tab leaves the tab list for the panel, skipping the unselected tabs.
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('selects the first enabled tab when given no value or defaultValue', async () => {
    const user = userEvent.setup();
    render(
      <Tabs>
        <TabList aria-label="Location details">
          <Tab value="reviews" disabled>
            Reviews
          </Tab>
          <Tab value="overview">Overview</Tab>
          <Tab value="sites">Sites</Tab>
        </TabList>
        <TabPanel value="reviews">No reviews yet.</TabPanel>
        <TabPanel value="overview">Camp among the peppermint trees.</TabPanel>
        <TabPanel value="sites">24 sites</TabPanel>
      </Tabs>
    );
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Overview')).toHaveAttribute('tabindex', '0');
    expect(tab('Reviews')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel', { name: 'Overview' })).toHaveTextContent(
      'Camp among the peppermint trees.'
    );
    await user.tab();
    expect(tab('Overview')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Sites')).toHaveAttribute('aria-selected', 'true');
  });
});
