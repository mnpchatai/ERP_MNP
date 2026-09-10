-- MRP database for the MAIN sheet page (mrp.html).
-- Source: "Material_M&P MRP 4-1_Ver_(Toy).xlsm", sheet DATA, columns A-U.
-- Applied to the ERP_MNP project as migrations mrp_excel_database,
-- mrp_normalized_lookup_columns, mrp_lookup_views and mrp_admin_write_access.
-- Safe to re-run on a fresh project.

-- 1. Sheet DATA A-U. Every column keeps its Excel header in a COMMENT, and the
--    app reads those same headers from COLUMNS in mrp-data.mjs.
create table if not exists public.mrp_bom_data (
  id                       bigserial primary key,
  row_no                   integer not null,
  item                     text not null,
  rb_weight_g              text,
  code                     text,
  dept_code                text,
  product_formula          text,
  se_color_rubber_type     text,
  se_length_rb_color       text,
  hole_thickness_rb_length text,
  se_od_rb_id              text,
  rb_od                    text,
  name                     text,
  maker_dept               text,
  qty_per_set              text,
  cut_length               text,
  cut_unit                 text,
  pcs_per_rb               text,
  pcs_unit                 text,
  qty_per_gr               text,
  gr_unit                  text,
  rb_count_unit            text,
  rb_weight_per_strand     text
);
-- Every cell stays text. The sheet mixes numbers with "-" placeholders in the
-- same column, and casting would silently rewrite what the planner sees today.

comment on table  public.mrp_bom_data                          is 'DATA sheet A-U from Material_M&P MRP 4-1_Ver_(Toy).xlsm';
comment on column public.mrp_bom_data.row_no                   is 'Excel row number in sheet DATA';
comment on column public.mrp_bom_data.item                     is 'A: ITEM';
comment on column public.mrp_bom_data.rb_weight_g              is 'B: น.น RB/g';
comment on column public.mrp_bom_data.code                     is 'C: CODE';
comment on column public.mrp_bom_data.dept_code                is 'D: รหัสแผนก';
comment on column public.mrp_bom_data.product_formula          is 'E: สินค้า/สูตรยาง';
comment on column public.mrp_bom_data.se_color_rubber_type     is 'F: สีSE/ประเภทยาง';
comment on column public.mrp_bom_data.se_length_rb_color       is 'G: ความยาวSE/สีRB';
comment on column public.mrp_bom_data.hole_thickness_rb_length is 'H: รู,ความหนา/ความยาวRB';
comment on column public.mrp_bom_data.se_od_rb_id              is 'I: วงนอกSE/รูในRB';
comment on column public.mrp_bom_data.rb_od                    is 'J: วงนอกRB';
comment on column public.mrp_bom_data.name                     is 'K: NAME';
comment on column public.mrp_bom_data.maker_dept               is 'L: แผนกผู้ผลิต';
comment on column public.mrp_bom_data.qty_per_set              is 'M: จำนวนที่ใช้ต่อชุด';
comment on column public.mrp_bom_data.cut_length               is 'N: ความยาวตัด';
comment on column public.mrp_bom_data.cut_unit                 is 'O: หน่วย';
comment on column public.mrp_bom_data.pcs_per_rb               is 'P: จำนวนชิ้นที่ได้ต่อเส้น RB';
comment on column public.mrp_bom_data.pcs_unit                 is 'Q: หน่วย';
comment on column public.mrp_bom_data.qty_per_gr               is 'R: จำนวนที่ได้ต่อ 1 GR';
comment on column public.mrp_bom_data.gr_unit                  is 'S: หน่วย';
comment on column public.mrp_bom_data.rb_count_unit            is 'T: หน่วยนับ RB';
comment on column public.mrp_bom_data.rb_weight_per_strand     is 'U: น.น ต่อเส้น RB / ก.ก';

-- The workbook carries stray spaces in ITEM, CODE and แผนกผู้ผลิต. Raw values are
-- kept untouched; lookups and filters use these trimmed columns instead.
alter table public.mrp_bom_data
  add column if not exists item_norm       text generated always as (nullif(btrim(item),'')) stored,
  add column if not exists code_norm       text generated always as (nullif(btrim(code),'')) stored,
  add column if not exists maker_dept_norm text generated always as (nullif(btrim(maker_dept),'')) stored;

create index if not exists mrp_bom_data_item_idx            on public.mrp_bom_data (item, row_no);
create index if not exists mrp_bom_data_code_idx            on public.mrp_bom_data (code);
create index if not exists mrp_bom_data_maker_dept_idx      on public.mrp_bom_data (maker_dept);
create index if not exists mrp_bom_data_item_norm_idx       on public.mrp_bom_data (item_norm, row_no);
create index if not exists mrp_bom_data_maker_dept_norm_idx on public.mrp_bom_data (maker_dept_norm);

-- 2. Reference lists. Departments mirror column L (แผนกผู้ผลิต); customers,
--    packages and colour sets come from the workbook's ';}o' sheet.
create table if not exists public.mrp_departments (code text primary key, name text not null, sort_order integer not null default 0);
create table if not exists public.mrp_customers  (id bigserial primary key, name text not null unique, sort_order integer not null default 0);
create table if not exists public.mrp_packages   (code text primary key, sort_order integer not null default 0);
create table if not exists public.mrp_color_sets (code text primary key, sort_order integer not null default 0);
comment on table public.mrp_departments is 'แผนก — อ้างอิงค่าจากคอลัมน์ L แผนกผู้ผลิต ของชีต DATA';

-- 3. Read-only for the browser: a select policy and nothing else, so the
--    publishable key cannot insert, update or delete.
alter table public.mrp_bom_data   enable row level security;
alter table public.mrp_departments enable row level security;
alter table public.mrp_customers   enable row level security;
alter table public.mrp_packages    enable row level security;
alter table public.mrp_color_sets  enable row level security;
create policy mrp_bom_data_read    on public.mrp_bom_data    for select to anon, authenticated using (true);
create policy mrp_departments_read on public.mrp_departments for select to anon, authenticated using (true);
create policy mrp_customers_read   on public.mrp_customers   for select to anon, authenticated using (true);
create policy mrp_packages_read    on public.mrp_packages    for select to anon, authenticated using (true);
create policy mrp_color_sets_read  on public.mrp_color_sets  for select to anon, authenticated using (true);

-- 4. Views the MAIN page reads: the ITEM dropdown and the department summary.
create or replace view public.mrp_items with (security_invoker = true) as
  select item_norm as item, count(*)::integer as line_count, min(row_no) as first_row
  from public.mrp_bom_data where item_norm is not null group by item_norm;

create or replace view public.mrp_maker_departments with (security_invoker = true) as
  select coalesce(d.maker_dept_norm, m.code) as code, m.name,
         coalesce(d.line_count, 0) as line_count, coalesce(m.sort_order, 999) as sort_order
  from (select maker_dept_norm, count(*)::integer as line_count
        from public.mrp_bom_data where maker_dept_norm is not null group by maker_dept_norm) d
  full join public.mrp_departments m on m.code = d.maker_dept_norm;

grant select on public.mrp_items, public.mrp_maker_departments to anon, authenticated;

-- 5. Loading sheet DATA is an admin action. Writes need an account listed in
--    mrp_admins, so a stray sign-up on this project cannot touch the BOM data.
create table if not exists public.mrp_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  added_at timestamptz not null default now()
);
alter table public.mrp_admins enable row level security;
revoke all on public.mrp_admins from anon, authenticated;
grant select on public.mrp_admins to authenticated;
create policy mrp_admins_self_read on public.mrp_admins for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.is_mrp_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mrp_admins where user_id = auth.uid())
$$;

grant insert, delete on public.mrp_bom_data to authenticated;
grant usage on sequence public.mrp_bom_data_id_seq to authenticated;
create policy mrp_bom_data_admin_insert on public.mrp_bom_data for insert to authenticated with check (public.is_mrp_admin());
create policy mrp_bom_data_admin_delete on public.mrp_bom_data for delete to authenticated using  (public.is_mrp_admin());

-- Grant an admin (find the id in Supabase -> Authentication -> Users):
--   insert into public.mrp_admins(user_id, note) values ('<user id>', 'MRP admin');

notify pgrst, 'reload schema';
