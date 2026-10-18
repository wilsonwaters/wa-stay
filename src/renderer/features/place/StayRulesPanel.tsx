import { CircleCheck, Clock } from 'lucide-react';
import type { StayRulesVerdict, StaySuggestion } from '../../../shared/types/provider.types';
import { Button, Notice } from '../../components/ui';

/** "8–15 Dec", or "29 Nov – 3 Dec" across months. */
export function suggestionLabel({ arrival, departure }: StaySuggestion): string {
  const format = (date: string, withMonth: boolean) =>
    new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      ...(withMonth ? { month: 'short' } : {}),
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
  return arrival.slice(0, 7) === departure.slice(0, 7)
    ? `${format(arrival, false)}–${format(departure, true)}`
    : `${format(arrival, true)} – ${format(departure, true)}`;
}

export interface StayRulesPanelProps {
  verdict: StayRulesVerdict;
  shortName: string;
  /** Sets the card's dates to a suggestion. */
  onSuggest: (stay: StaySuggestion) => void;
}

/**
 * What the provider's published booking rules say about the dates in the card, before
 * anything is checked (`catalog.stayRules`): when the stay goes on sale, if not yet; whether
 * the rules allow it, and if not why, with dates they would take as buttons that set them; and
 * the notes worth knowing either way.
 */
export function StayRulesPanel({ verdict, shortName, onSuggest }: StayRulesPanelProps) {
  const { release, notes } = verdict;
  return (
    <div className="flex flex-col gap-3" aria-label={`${shortName}'s booking rules`} role="group">
      {release && !release.open && (
        <Notice tone="info" icon={Clock}>
          {release.text}
        </Notice>
      )}
      {verdict.ok ? (
        <p className="flex items-start gap-1.5 text-sm text-fg-secondary">
          <CircleCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-available-fg" />
          <span>
            {shortName}&apos;s booking rules allow this stay.
            {release?.open && release.text !== 'On sale.' ? ` ${release.text}` : ''}
          </span>
        </p>
      ) : (
        <Notice tone="warning" title={`${shortName}'s booking rules don't allow this stay`}>
          <p>{verdict.reason}</p>
          {verdict.suggestions && verdict.suggestions.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              <p className="font-medium text-fg">Try these dates:</p>
              <ul role="list" className="flex flex-wrap gap-2">
                {verdict.suggestions.map((suggestion) => (
                  <li key={`${suggestion.arrival}|${suggestion.departure}`}>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Use ${suggestionLabel(suggestion)}`}
                      onClick={() => onSuggest(suggestion)}
                    >
                      {suggestionLabel(suggestion)}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Notice>
      )}
      {notes.length > 0 && (
        <ul role="list" className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg-muted">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default StayRulesPanel;
