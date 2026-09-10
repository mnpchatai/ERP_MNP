-- RB snapshot pilot ONLY. Run once in the target project's SQL Editor.
-- A pre-existing table intentionally aborts the transaction; inspect it first.
begin;
create table public.rb_trial_plans (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id),
  reference text not null check (char_length(btrim(reference)) between 1 and 80),
  rule_version text not null check (rule_version = 'trial-0.1'),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 50000
    and snapshot ?& array['id','reference','ruleVersion','inputs','result','product','created','seStock']
    and snapshot->>'id' = id::text
    and snapshot->>'reference' = reference
    and snapshot->>'ruleVersion' = rule_version
    and snapshot->'seStock' = 'null'::jsonb
    and jsonb_typeof(snapshot->'inputs') = 'object'
    and jsonb_typeof(snapshot->'result') = 'object'
  ),
  created_at timestamptz not null default now()
);
create index rb_trial_plans_owner_created_idx on public.rb_trial_plans(owner_id, created_at desc, id desc);
alter table public.rb_trial_plans enable row level security;
revoke all on public.rb_trial_plans from public, anon, authenticated;
grant select, insert on public.rb_trial_plans to authenticated;
create policy rb_owner_read on public.rb_trial_plans for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy rb_owner_insert on public.rb_trial_plans for insert to authenticated
  with check ((select auth.uid()) = owner_id);
-- Immutable snapshots: no update/delete grants or policies. No public reads.
notify pgrst, 'reload schema';
commit;
