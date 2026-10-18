# RI2: Stay rules module

## Description

ParkStay and RAC learn a stay's rules from their availability answers: RAC's minimum nights and arrival days become `min-stay` nights (R8). A links-only provider has no availability answer.

Stay Rottnest's rules are published instead, in its booking guides:

- the 5/3 rule;
- peak fixed arrival and departure blocks per precinct;
- Saturday two-night minimums;
- no public-holiday arrivals or departures;
- a 14-night maximum;
- occupancy per unit type.

WA Stay must not suggest, remind about or plan a stay that RIA would refuse (terms rule 8).

This task adds an optional, pure provider module, `stayRules.check`. The core uses it to refuse such a stay in watches and snipes, and to explain the rules on the place page.

## Size

M. A module type, a registry consistency rule, a core service method, one IPC method, and validation in two services.

## Depends on

- RI1 (the fake links-only provider, §12.36).

## Scope

1. **Type** (`sdk/provider.ts`):

   ```ts
   interface StayRulesInput {
     externalId: string;
     stay: StayQuery;
     unitIds?: string[];
     unitKinds?: UnitKind[];
     now: Date;
   }
   interface StayRuleNote { kind: 'rule' | 'release' | 'closure'; text: string }
   interface StayReleaseStatus { open: boolean; opensAt?: Date; text: string }
   type StayRulesVerdict =
     | { ok: true; notes: StayRuleNote[]; release?: StayReleaseStatus }
     | { ok: false; reason: string; field: 'arrival' | 'departure' | 'guests' | 'units';
         notes: StayRuleNote[]; release?: StayReleaseStatus };
   interface StayRulesModule { check(input: StayRulesInput): StayRulesVerdict }
   ```

   `check` is synchronous and pure: no request, no state. It is optional for every provider.
2. **Registry:** a consistency rule. A links-only provider with `watches` or `snipes` must have `stayRules`, because without it WA Stay could plan a stay RIA refuses.
3. **Catalogue service:** `stayRules(key, stay, unitIds?, unitKinds?)` calls the provider's `check` with the clock's `now`. Reasons and notes are at most 200 characters, and longer ones are cut with a warning.
4. **IPC:** `catalog.stayRules({ key, stay, unitIds?, unitKinds? })` (channel `catalog:stay-rules`), answering the verdict; `CAPABILITY` without the module. Contract, handler, preload and parity tests, as `CLAUDE.md` "Adding a method" says. A renderer hook `useStayRules` in `src/renderer/api/` (RI5 shows it).
5. **Watches and snipes:** `create` and `update` (place, stay, units or stay types changed) call `check` when the provider has it. A refusal is `VALIDATION` with the issue path the verdict's `field` maps to (`stay.arrival`, `stay.departure`, `stay.guests`, `unitIds`) and the provider's reason. This applies to every provider with the module; ParkStay and RAC have none, so nothing changes for them.
6. **§12.36:** append the module and the IPC method.

## Non-goals

- Rottnest's rules (RI4); the screens (RI5, RI7, RI9).
- Replacing availability-derived rules for ParkStay or RAC.

## Completion criteria

- [ ] Registry: a links-only provider with watches and no `stayRules` is refused; with it, it registers.
- [ ] `tests/unit/core/stay-rules.test.ts`: a refusal maps to `VALIDATION` with each field's issue path, for create and for each kind of update; an `ok` verdict saves; a provider without the module is unaffected.
- [ ] The IPC parity and handler tests pass; `CAPABILITY` without the module.
- [ ] The contract suite (links-only) calls `check` with zero requests.
- [ ] The full gate passes, including `build:e2e` and `test:e2e` (IPC changed).
