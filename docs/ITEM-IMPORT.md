# Source Item catalog

The RB page now has a separate authenticated Item catalog. It does not substitute
real items into the DEMO calculator. Search is by item-code prefix, returning at
most 50 records. Each source workbook version stays separate, keyed by SHA-256.

Scope: DATA A:U, items with at least one exact department code RB in column D.
Import preserves source text values, source row numbers and error types for RB
component rows. The full diagnostic extraction, including formulas and other
department rows, remains private locally and is NOT published to GitHub.

The database catalog is read-only to its owning authenticated user. Anonymous
users and other accounts have no access. Additional staff access requires an
explicit authorization decision; there is no automatic access for new signups.

No production approval, live stock, full BOM explosion or fresh Excel recalculation
is implied. SE stock remains unavailable. These are source-file cached values.
The old demo calculator and snapshot history retain their separate trial status.
