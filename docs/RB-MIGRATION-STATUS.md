# RB migration status

This is a development checkpoint, not production acceptance. Existing rb.html
remains a simulation; it does not use the verified Excel kernel yet.

## Confirmed calculation slice

Both supplied RB planning workbooks use these formulas in `(O.o)` row 8:

| Result | Excel formula |
|---|---|
| I | G * H / 1000 |
| L | K * I |
| N | M * I |
| O | I + J + L + N |
| P | ROUNDUP(O / V, 0) * V / U |
| Q | ROUNDUP(P * U / S, 0) |

`rb-excel.mjs` transcribes this slice for nonnegative finite numeric inputs.
K/M use fractional percentages. J remains included at zero quantity, matching
the source formula rather than the earlier prototype's conditional setup.
Q is a whole batch count; P can be fractional. Missing/error values are rejected.
No SE stock value is inferred and no stock subtraction is introduced here.

## Observed VBA behavior

Industrial planner Module1 `Save` copies B14:BJ175 as values into
Chronicle_Working. Module2 `Update_Data` copies B14:AU175 instead.
These differing snapshot widths need separate handling, not silent unification.
`Screen_DATA_ITME` filters DATA BOM on column 22, copies visible V:AP
as values to AS onward. Calculation lookups then read AR:BN.
Printing increments document counters. Printing must not be treated as a
side-effect-free preview in a later workflow migration.

## Release gates still open

- Resolve the complete ITEM/color/BOM lookup and duplicate-key behavior.
- Inspect all planning-sheet formulas, including shared formulas and VBA events.
- Resolve external workbook dependencies and existing Excel error values without
  replacing them with zeros or silently correcting source business content.
- Compare multiple items, boundary cases and fresh Excel recalculation results;
  saved cached values alone do not prove current correctness.
- Build authenticated database integration, access policies, backup/restore and
  concurrent document numbering; test using non-production records first.
- Keep SE stock NULL/unknown until an approved source is available.
- Obtain operator acceptance of documents, units, rounding and item links.

## Local validation

`node --test rb-calc.test.mjs rb-excel.test.mjs`

`node tools/verify-rb.mjs .private-rb/0/audit.json .private-rb/1/audit.json`

Real source files, extracted VBA, audit caches and credentials must remain out of
this public repository. The audit tool reads files without executing macros;
its row-limited output is diagnostic, not a complete database import.
