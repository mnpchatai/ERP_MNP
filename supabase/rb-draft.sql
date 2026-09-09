-- Draft schema only. Not applied. Real data must not be committed to Git.
create table public.rb_trial_plans (
 id uuid primary key,
 owner_id uuid not null default auth.uid() references auth.users(id),
 reference text not null,
 rule_version text not null,
 snapshot jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.rb_trial_plans enable row level security;
revoke all on public.rb_trial_plans from anon;
grant select, insert on public.rb_trial_plans to authenticated;
create policy owner_read on public.rb_trial_plans for select to authenticated using (owner_id = auth.uid());
create policy owner_insert on public.rb_trial_plans for insert to authenticated with check (owner_id = auth.uid());
-- Snapshot-only pilot; no cross-department sharing, stock transactions, or approvals yet.
