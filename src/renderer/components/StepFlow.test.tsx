import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepFlow, type FlowStep } from './StepFlow';
import { Field, TextField } from './ui';

const STEPS: FlowStep[] = [
  { id: 'one', title: 'Provider' },
  { id: 'two', title: 'Location' },
  { id: 'three', title: 'Review' },
];

function Flow({
  start = 'one',
  valid = () => true,
  onFinish = jest.fn(),
}: {
  start?: string;
  valid?: (step: string) => boolean;
  onFinish?: () => void;
}) {
  const [current, setCurrent] = useState(start);
  const [error, setError] = useState<string>();
  return (
    <>
      <h1 tabIndex={-1}>New thing</h1>
      <StepFlow
        label="New thing steps"
        steps={STEPS}
        current={current}
        onStepChange={setCurrent}
        finalLabel="Create thing"
        onContinue={() => {
          const ok = valid(current);
          setError(ok ? undefined : 'Enter a name');
          if (ok && current === 'three') onFinish();
          return ok;
        }}
      >
        <Field label="Name" error={error}>
          <TextField />
        </Field>
      </StepFlow>
    </>
  );
}

const stepList = () => screen.getByRole('navigation', { name: 'New thing steps' });

describe('StepFlow', () => {
  it('marks the current step aria-current="step" and names the step heading with its position', () => {
    render(<Flow />);
    const items = stepList().querySelectorAll('li');
    expect(items[0]).toHaveAttribute('aria-current', 'step');
    expect(items[1]).not.toHaveAttribute('aria-current');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Step 1 of 3: Provider' })
    ).toBeInTheDocument();
  });

  it('does not take focus on first render, so the page heading keeps it', () => {
    render(<Flow />);
    expect(screen.getByRole('heading', { level: 2 })).not.toHaveFocus();
  });

  it('moves focus to the new step heading on Continue and Back', async () => {
    const user = userEvent.setup();
    render(<Flow />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const heading = screen.getByRole('heading', { level: 2, name: 'Step 2 of 3: Location' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(stepList().querySelectorAll('li')[1]).toHaveAttribute('aria-current', 'step');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Step 1 of 3: Provider' })).toHaveFocus()
    );
  });

  it('lets a finished step be revisited from the list, but not a later one', async () => {
    const user = userEvent.setup();
    render(<Flow start="three" />);
    expect(within(stepList()).queryByRole('button', { name: /Review/ })).toBeNull();
    await user.click(within(stepList()).getByRole('button', { name: 'Provider, done' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Step 1 of 3: Provider' })).toHaveFocus();
  });

  it('stays on a step that fails its check and focuses the first invalid field, described by its error', async () => {
    const user = userEvent.setup();
    render(<Flow valid={() => false} />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const input = screen.getByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a name');
    expect(screen.getByRole('heading', { level: 2, name: /Provider/ })).toBeInTheDocument();
  });

  it('shows the final label on the last step and finishes once', async () => {
    const user = userEvent.setup();
    const onFinish = jest.fn();
    render(<Flow start="three" onFinish={onFinish} />);
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create thing' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
