import { render, screen } from '@testing-library/react';
import { DESCRIPTION_HTML } from '../../../tests/fixtures/catalog/place-detail';
import { RichText } from './RichText';

describe('RichText', () => {
  it("renders main's sanitised description formatted: paragraphs, lists, emphasis, links", () => {
    render(<RichText html={DESCRIPTION_HTML} />);
    expect(screen.getByText('Ningaloo coast').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Bring your own water',
      'No generators',
    ]);
    // Main gives each link target="_blank", which the app window sends to the browser.
    const link = screen.getByRole('link', { name: 'park guide' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
