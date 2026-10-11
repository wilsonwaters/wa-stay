import { render } from '@testing-library/react';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it.each(['rect', 'text', 'circle'] as const)(
    'the %s shape is hidden from assistive technology',
    (shape) => {
      const { container } = render(<Skeleton shape={shape} />);
      expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
      expect(container.firstElementChild).toBeEmptyDOMElement();
    }
  );
});
