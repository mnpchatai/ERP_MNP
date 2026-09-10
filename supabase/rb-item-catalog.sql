-- Read-only catalog of source items containing RB components.
-- No manufacturing approval or live recalculation is implied by an import.
begin;
create table public.rb_item_catalog (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 source_hash text not null,
 source_name text not null,
 item_code text not null,
 item_name text not null,
 rb_count integer not null check(rb_count>0),
 bom_row_count integer not null,
 rb_rows jsonb not null check(jsonb_typeof(rb_rows)='array'),
 production_ready boolean not null default false check(production_ready=false),
 imported_at timestamptz not null default now(),
 unique(owner_id,source_hash,item_code)
);
create index rb_item_catalog_owner_code_idx on public.rb_item_catalog(owner_id,item_code);
alter table public.rb_item_catalog enable row level security;
revoke all on public.rb_item_catalog from public,anon,authenticated;
grant select on public.rb_item_catalog to authenticated;
create policy catalog_owner_read on public.rb_item_catalog for select to authenticated
 using ((select auth.uid())=owner_id);
notify pgrst,'reload schema';
commit;
