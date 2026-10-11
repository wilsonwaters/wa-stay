import { useEffect, useMemo, useRef, useState, type FormEvent, type Ref } from 'react';
import { Search } from 'lucide-react';
import { todayIn } from '../../../../shared/utils/calendar-date';
import {
  Combobox,
  DateRangeField,
  GuestsField,
  IconButton,
  type ComboboxOption,
  type DateRange,
  type Guests,
} from '../../../components/ui';
import { suggest, type Suggestion, type SuggestionIndex } from './suggestions';

/** Typing in "Where" searches after this pause. */
export const SEARCH_DEBOUNCE_MS = 250;
/** The longest stay the date picker allows (EQ6). */
export const MAX_NIGHTS = 30;
const PERTH = 'Australia/Perth';

export interface SearchPillProps {
  /** The applied search text (`q`). */
  query: string;
  index: SuggestionIndex;
  dates: DateRange;
  guests: Guests | undefined;
  /** Sets `q`: after a pause while typing, at once on Enter or Search. */
  onQueryChange: (text: string) => void;
  onSuggestion: (suggestion: Suggestion) => void;
  onDatesChange: (dates: DateRange) => void;
  onGuestsChange: (guests: Guests) => void;
  /** When's button, to open the calendar from elsewhere ("Try different dates"). */
  datesTriggerRef?: Ref<HTMLButtonElement>;
}

const Divider = () => <span aria-hidden="true" className="h-8 w-px shrink-0 bg-border" />;

/**
 * The Airbnb-style search pill: Where (the local catalogue's regions, areas and places),
 * When, Who, and the coral Search button. Dates and guests go into the URL for the detail
 * page and availability (E2, E3).
 */
export function SearchPill({
  query,
  index,
  dates,
  guests,
  onQueryChange,
  onSuggestion,
  onDatesChange,
  onGuestsChange,
  datesTriggerRef,
}: SearchPillProps) {
  // What is typed; it follows `q` whenever `q` changes from elsewhere (Back, Clear filters).
  const [draft, setDraft] = useState(query);
  const appliedRef = useRef(query);
  useEffect(() => {
    if (query !== appliedRef.current) {
      appliedRef.current = query;
      setDraft(query);
    }
  }, [query]);

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const apply = (text: string) => {
    clearTimeout(timer.current);
    const next = text.trim();
    appliedRef.current = next;
    if (next !== query) onQueryChange(next);
  };

  // Choosing an option makes the Combobox write the option's label into the text; that is not
  // typing, so it must not become the search.
  const choosing = useRef(false);

  const suggestions = useMemo(() => suggest(index, draft), [index, draft]);
  const options: ComboboxOption[] = useMemo(
    () =>
      suggestions.map((s) => ({
        value: s.value,
        label: s.label,
        description: s.description,
        group: s.group,
      })),
    [suggestions]
  );

  const onInputChange = (text: string) => {
    if (choosing.current) {
      choosing.current = false;
      return;
    }
    setDraft(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(text), SEARCH_DEBOUNCE_MS);
  };

  const onChoose = (value: string | null) => {
    const suggestion = suggestions.find((s) => s.value === value);
    if (!suggestion) return;
    choosing.current = true;
    clearTimeout(timer.current);
    // A region or a place clears the text (the chip or the selection shows the choice); an
    // area becomes the search text.
    const text = suggestion.kind === 'area' ? suggestion.label : '';
    appliedRef.current = text;
    setDraft(text);
    onSuggestion(suggestion);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    apply(draft);
  };

  const today = todayIn(PERTH);

  return (
    <form
      role="search"
      aria-label="Search places"
      onSubmit={submit}
      className="mx-auto flex w-full max-w-[860px] items-center rounded-full border border-border bg-surface p-1.5 shadow-pill"
    >
      <Combobox
        label="Where"
        appearance="segment"
        className="min-w-0 flex-[1.5]"
        options={options}
        value={null}
        onChange={onChoose}
        inputValue={draft}
        onInputChange={onInputChange}
        filter={false}
        placeholder="Search places, parks or regions"
        emptyMessage="No matching places. Press Enter to search anyway."
      />
      <Divider />
      <DateRangeField
        label="When"
        appearance="segment"
        className="min-w-0 flex-1 [&>button]:w-full"
        value={dates}
        onChange={onDatesChange}
        minDate={today}
        maxNights={MAX_NIGHTS}
        triggerRef={datesTriggerRef}
      />
      <Divider />
      <GuestsField
        label="Who"
        appearance="segment"
        className="min-w-0 flex-1 [&>button]:w-full"
        value={guests}
        onChange={onGuestsChange}
      />
      <IconButton
        type="submit"
        label="Search"
        variant="primary"
        size="lg"
        shape="pill"
        icon={<Search size={20} />}
        className="ml-1"
      />
    </form>
  );
}
