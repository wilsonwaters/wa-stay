# RI4: Stay rules module

## Description

Rottnest's booking rules are published in RIA's guides, not in its availability answers:

- fixed peak blocks;
- the 5/3 rule;
- Saturday two-night minimums;
- no public-holiday arrivals or departures;
- at most 14 nights;
- occupancy per type.

The SDK gets an optional, pure provider module, `stayRules.check`. The core uses it to refuse a stay the provider would refuse, and the place page uses it to explain the rules (RI6).

## Size

M.

## Scope

1. **Type** (`sdk/provider.ts`): `stayRules.check({ externalId, stay, unitIds?, unitKinds?, now })` returns one of:
   - `{ ok: true, notes, release? }`;
   - `{ ok: false, reason, field: 'arrival' | 'departure' | 'guests' | 'units', notes, release? }`.

   `release` is `{ open, opensAt?, text }`. The module is pure and sends no request.
2. **The catalogue service:** `stayRules(key, stay, …)`, with text cut to 200 characters.
3. **IPC:** `catalog.stayRules({ key, stay, unitIds?, unitKinds? })` answers the verdict, or `CAPABILITY` without the module.
4. **Watches and snipes:** `create`, and an `update` that changes the place, stay, units or stay types, refuse a provider's refusal with `VALIDATION` on the verdict's field (`stay.arrival`, `stay.departure`, `stay.guests`, `unitIds`).

## Completion criteria

- [x] Core tests for each field.
- [x] Providers without the module are unchanged.
- [x] The IPC parity tests pass.
- [x] The full gate passes.

## Notes from the build

- Built as specified (architecture-notes §12.37), with `suggestions` on a refusal (RI6's chips) and `notes` either way.
- The cleaning lives in `src/main/core/stay-rules.ts` (`checkStayRules`), shared by the catalogue, watch and snipe services; a module that throws or answers nonsense gives no verdict.
- `guests` maps to `stay.adults` (the form's party field), as the watch form's `issueField` reads it.
