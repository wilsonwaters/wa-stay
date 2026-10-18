# Stay Rottnest fixtures

- `results-2027-06-28-3n-1a.html`: Stay Rottnest's results page for 28 Jun – 1 Jul 2027 (three nights, one adult), **trimmed** from the stakeholder's own browser capture of 18 Oct 2026. No agent requested it. Only each room type's card is kept: its attributes, RIA's name for it, its "from" price and its rates' names. Photos, descriptions, scripts, styles, analytics and the booking step's buttons are left out. 34 room types are free and 34 unavailable.
- `results-all-unavailable.html`: **synthetic**, the same page with every room type marked unavailable, as a sold-out stay reads.
- `manifest.json`: the `FixtureHttpClient` routes. A search for 28 Jun – 1 Jul 2027 answers the capture, and one for 14–17 Jun 2027 answers the sold-out page.

`tests/unit/providers/rottnest/precincts.test.ts` checks that nothing of RIA's but these facts is kept.
