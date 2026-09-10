# RB Cloud checkpoint — 2026-09-10

Applied create_rb_trial_plans_owner_snapshots to the configured Supabase project.
The RB page can sign in, insert immutable pilot snapshots and list the owner's
history in pages of 20. Legacy browser copies remain separate. SE stock is NULL.

Database verification passed in a rolled-back transaction: authenticated owner
insert/read, cross-owner read isolation and insert rejection. Anonymous SELECT,
authenticated UPDATE and DELETE have no grants. No test rows were retained.
16 local unit tests passed; these are not a claim of full Excel equivalence.

Supabase advisor reported leaked-password protection disabled. No auth settings
were changed. Review https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

The earlier connection-only documentation is superseded by this checkpoint.
Sessions use sessionStorage across navigation in the same tab. Sign out on shared
devices. The cloud dataset remains a pilot, not operational manufacturing data.
Browser save/read with an actual employee login still requires acceptance testing.
