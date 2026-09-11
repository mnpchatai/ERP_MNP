-- ERP_MNP core data layer — DESIGN DRAFT, NOT APPLIED.
-- Do not run this against the production project without review; apply it to a
-- throwaway/staging Supabase project first and confirm RLS behaviour per role.
--
-- Scope: this formalises the flow currently simulated client-side in app.js
-- (mnp-erp-demo-v1: items/departments/boms/routing/orders/productions/events)
-- and extends it to full ERP coverage: parties, inventory valuation, sales,
-- purchase and general ledger. It is a separate namespace from the existing
-- mrp_* tables (Excel DATA-sheet import for the RB weight calculator) and
-- rb_* tables (RB trial-plan snapshots) — those stay as they are.
--
-- Naming convention: one short module prefix per table group —
--   org_  access control / departments
--   mst_  master data shared by every module
--   inv_  inventory ledger and balances
--   prod_ BOM / routing / manufacturing orders
--   sal_  sales
--   pur_  purchasing
--   gl_   general ledger
--   aud_  audit log
--
-- What this draft does NOT decide yet (left for the application layer):
--   which GL accounts a given sales invoice or goods receipt posts to —
--   gl_account_defaults gives named anchors (AR_CONTROL, COGS, ...) but the
--   posting rules themselves belong in service code, not a trigger, so they
--   stay reviewable and testable like rb-excel.mjs's calculation slice.

create extension if not exists pgcrypto;

-- =========================================================================
-- 1. Access control
-- =========================================================================

create table if not exists public.org_departments (
  code       text primary key,
  name       text not null,
  is_active  boolean not null default true
);
comment on table public.org_departments is 'ERP-wide departments/cost centers. Independent of mrp_departments (RB workbook lookup).';

create table if not exists public.org_user_roles (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','sales','purchase','production','accounting','viewer')),
  dept_code  text references public.org_departments(code),
  created_at timestamptz not null default now(),
  unique (user_id, role, dept_code)
);

create or replace function public.org_has_role(p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_user_roles
    where user_id = auth.uid() and (role = p_role or role = 'admin')
  )
$$;

create or replace function public.org_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.org_has_role('admin')
$$;

-- =========================================================================
-- 2. Master data
-- =========================================================================

create table if not exists public.mst_uom (
  code text primary key,
  name text not null
);

create table if not exists public.mst_items (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  name                text not null,
  item_type           text not null check (item_type in ('FG','RM','WIP','SERVICE')),
  uom_code            text not null references public.mst_uom(code),
  category            text,
  is_active           boolean not null default true,
  standard_cost       numeric(18,4) not null default 0,
  sales_price         numeric(18,4) not null default 0,
  created_at          timestamptz not null default now()
);

create table if not exists public.mst_parties (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  is_customer      boolean not null default false,
  is_vendor        boolean not null default false,
  tax_id           text,
  address          text,
  phone            text,
  email            text,
  credit_terms_days integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  check (is_customer or is_vendor)
);

create table if not exists public.gl_chart_of_accounts (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  account_type text not null check (account_type in ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  parent_id    uuid references public.gl_chart_of_accounts(id),
  is_active    boolean not null default true
);

-- Named anchors so application code never hardcodes an account id. Seed rows
-- (AR_CONTROL, AP_CONTROL, INVENTORY, SALES_REVENUE, COGS, VAT_OUTPUT,
-- VAT_INPUT, ...) are inserted once the chart of accounts exists.
create table if not exists public.gl_account_defaults (
  key        text primary key,
  account_id uuid not null references public.gl_chart_of_accounts(id)
);

create table if not exists public.mst_tax_codes (
  code      text primary key,
  name      text not null,
  rate      numeric(6,4) not null,
  direction text not null check (direction in ('OUTPUT','INPUT'))
);

-- Document numbering (SO-2609001 style: prefix + period + running seq).
create table if not exists public.mst_numbering_sequences (
  doc_type text primary key,
  prefix   text not null,
  period   text not null default to_char(now(), 'YYMM'),
  last_seq bigint not null default 0
);

create or replace function public.mst_next_doc_no(p_doc_type text) returns text
language plpgsql security definer set search_path = public as $$
declare v_row public.mst_numbering_sequences%rowtype; v_period text := to_char(now(),'YYMM');
begin
  insert into public.mst_numbering_sequences(doc_type, prefix, period, last_seq)
  values (p_doc_type, p_doc_type, v_period, 0)
  on conflict (doc_type) do nothing;

  update public.mst_numbering_sequences
    set last_seq = case when period = v_period then last_seq + 1 else 1 end,
        period   = v_period
    where doc_type = p_doc_type
    returning * into v_row;

  return v_row.prefix || '-' || v_row.period || lpad(v_row.last_seq::text, 3, '0');
end $$;

-- =========================================================================
-- 3. Inventory (immutable ledger + derived balance)
-- =========================================================================

create table if not exists public.inv_warehouses (
  code      text primary key,
  name      text not null,
  is_active boolean not null default true
);

create table if not exists public.inv_stock_ledger (
  id             bigserial primary key,
  item_id        uuid not null references public.mst_items(id),
  warehouse_code text not null references public.inv_warehouses(code),
  txn_type       text not null check (txn_type in
                   ('PO_RECEIPT','SO_ISSUE','MO_ISSUE','MO_RECEIPT','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT')),
  ref_type       text not null,
  ref_id         uuid not null,
  qty            numeric(18,4) not null,      -- positive = in, negative = out
  unit_cost      numeric(18,4),               -- required on positive (receipt) rows
  txn_at         timestamptz not null default now(),
  created_by     uuid not null default auth.uid()
);
comment on table public.inv_stock_ledger is 'Append-only. Corrections are new ADJUSTMENT rows, never edits.';

create table if not exists public.inv_stock_balances (
  item_id        uuid not null references public.mst_items(id),
  warehouse_code text not null references public.inv_warehouses(code),
  qty_on_hand    numeric(18,4) not null default 0,
  avg_cost       numeric(18,4) not null default 0,
  primary key (item_id, warehouse_code)
);

create or replace function public.inv_apply_stock_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bal public.inv_stock_balances%rowtype;
begin
  insert into public.inv_stock_balances(item_id, warehouse_code)
  values (new.item_id, new.warehouse_code)
  on conflict (item_id, warehouse_code) do nothing;

  select * into v_bal from public.inv_stock_balances
    where item_id = new.item_id and warehouse_code = new.warehouse_code for update;

  if new.qty > 0 then
    update public.inv_stock_balances set
      avg_cost = case when v_bal.qty_on_hand + new.qty = 0 then 0
                 else (v_bal.qty_on_hand * v_bal.avg_cost + new.qty * coalesce(new.unit_cost,0))
                      / (v_bal.qty_on_hand + new.qty) end,
      qty_on_hand = v_bal.qty_on_hand + new.qty
    where item_id = new.item_id and warehouse_code = new.warehouse_code;
  else
    if v_bal.qty_on_hand + new.qty < 0 then
      raise exception 'insufficient stock for item % in warehouse %: on hand %, requested %',
        new.item_id, new.warehouse_code, v_bal.qty_on_hand, -new.qty;
    end if;
    update public.inv_stock_balances set qty_on_hand = v_bal.qty_on_hand + new.qty
    where item_id = new.item_id and warehouse_code = new.warehouse_code;
  end if;
  return new;
end $$;

drop trigger if exists trg_inv_stock_ledger_apply on public.inv_stock_ledger;
create trigger trg_inv_stock_ledger_apply after insert on public.inv_stock_ledger
  for each row execute function public.inv_apply_stock_ledger();

-- =========================================================================
-- 4. Production — BOM, routing, manufacturing orders
--    (formalises app.js: boms{itemId:{version,lines}}, routing{itemId:[...]})
-- =========================================================================

create table if not exists public.prod_boms (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.mst_items(id),
  version         text not null,
  is_active       boolean not null default true,
  effective_from  date not null default current_date,
  created_at      timestamptz not null default now(),
  unique (item_id, version)
);

create table if not exists public.prod_bom_lines (
  id                 uuid primary key default gen_random_uuid(),
  bom_id             uuid not null references public.prod_boms(id) on delete cascade,
  component_item_id  uuid not null references public.mst_items(id),
  qty_per_unit       numeric(18,6) not null,
  scrap_pct          numeric(6,4) not null default 0,
  dept_code          text references public.org_departments(code)
);

create table if not exists public.prod_routings (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.mst_items(id),
  version    text not null,
  is_active  boolean not null default true,
  unique (item_id, version)
);

create table if not exists public.prod_routing_steps (
  id              uuid primary key default gen_random_uuid(),
  routing_id      uuid not null references public.prod_routings(id) on delete cascade,
  seq             integer not null,
  dept_code       text not null references public.org_departments(code),
  target_per_hour numeric(18,4) not null,
  setup_minutes   numeric(18,2) not null default 0,
  unique (routing_id, seq)
);

create table if not exists public.prod_manufacturing_orders (
  id              uuid primary key default gen_random_uuid(),
  doc_no          text not null unique,
  item_id         uuid not null references public.mst_items(id),
  qty             numeric(18,4) not null,
  bom_id          uuid not null references public.prod_boms(id),      -- frozen snapshot
  routing_id      uuid not null references public.prod_routings(id),  -- frozen snapshot
  sales_order_id  uuid,
  status          text not null default 'DRAFT'
                   check (status in ('DRAFT','RELEASED','IN_PROGRESS','DONE','CANCELLED')),
  due_date        date,
  created_at      timestamptz not null default now()
);

create table if not exists public.prod_mo_operations (
  id           uuid primary key default gen_random_uuid(),
  mo_id        uuid not null references public.prod_manufacturing_orders(id) on delete cascade,
  seq          integer not null,
  dept_code    text not null references public.org_departments(code),
  status       text not null default 'PENDING'
                check (status in ('PENDING','READY','RUNNING','DONE')),
  qty_good     numeric(18,4) not null default 0,
  qty_reject   numeric(18,4) not null default 0,
  started_at   timestamptz,
  finished_at  timestamptz,
  unique (mo_id, seq)
);

-- =========================================================================
-- 5. Sales
-- =========================================================================

create table if not exists public.sal_sales_orders (
  id          uuid primary key default gen_random_uuid(),
  doc_no      text not null unique,
  customer_id uuid not null references public.mst_parties(id),
  order_date  date not null default current_date,
  due_date    date,
  status      text not null default 'DRAFT'
               check (status in ('DRAFT','CONFIRMED','IN_PRODUCTION','DELIVERED','INVOICED','CANCELLED')),
  currency    text not null default 'THB',
  created_at  timestamptz not null default now()
);

create table if not exists public.sal_sales_order_lines (
  id          uuid primary key default gen_random_uuid(),
  so_id       uuid not null references public.sal_sales_orders(id) on delete cascade,
  item_id     uuid not null references public.mst_items(id),
  qty         numeric(18,4) not null,
  unit_price  numeric(18,4) not null,
  tax_code    text references public.mst_tax_codes(code)
);

create table if not exists public.sal_deliveries (
  id            uuid primary key default gen_random_uuid(),
  doc_no        text not null unique,
  so_id         uuid not null references public.sal_sales_orders(id),
  delivery_date date not null default current_date,
  status        text not null default 'DRAFT' check (status in ('DRAFT','POSTED','CANCELLED'))
);

create table if not exists public.sal_delivery_lines (
  id           uuid primary key default gen_random_uuid(),
  delivery_id  uuid not null references public.sal_deliveries(id) on delete cascade,
  so_line_id   uuid not null references public.sal_sales_order_lines(id),
  qty          numeric(18,4) not null
);

create table if not exists public.sal_sales_invoices (
  id            uuid primary key default gen_random_uuid(),
  doc_no        text not null unique,
  customer_id   uuid not null references public.mst_parties(id),
  so_id         uuid references public.sal_sales_orders(id),
  invoice_date  date not null default current_date,
  due_date      date,
  status        text not null default 'DRAFT' check (status in ('DRAFT','POSTED','PAID','VOID')),
  subtotal      numeric(18,4) not null default 0,
  tax_amount    numeric(18,4) not null default 0,
  total         numeric(18,4) not null default 0
);

create table if not exists public.sal_sales_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.sal_sales_invoices(id) on delete cascade,
  item_id     uuid not null references public.mst_items(id),
  qty         numeric(18,4) not null,
  unit_price  numeric(18,4) not null,
  tax_code    text references public.mst_tax_codes(code)
);

create table if not exists public.sal_receipts (
  id            uuid primary key default gen_random_uuid(),
  doc_no        text not null unique,
  customer_id   uuid not null references public.mst_parties(id),
  receipt_date  date not null default current_date,
  amount        numeric(18,4) not null,
  method        text
);

create table if not exists public.sal_receipt_allocations (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references public.sal_receipts(id) on delete cascade,
  invoice_id  uuid not null references public.sal_sales_invoices(id),
  amount      numeric(18,4) not null
);

-- =========================================================================
-- 6. Purchasing (mirrors Sales)
-- =========================================================================

create table if not exists public.pur_purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  doc_no      text not null unique,
  vendor_id   uuid not null references public.mst_parties(id),
  order_date  date not null default current_date,
  due_date    date,
  status      text not null default 'DRAFT'
               check (status in ('DRAFT','CONFIRMED','PARTIALLY_RECEIVED','RECEIVED','BILLED','CANCELLED')),
  currency    text not null default 'THB',
  created_at  timestamptz not null default now()
);

create table if not exists public.pur_purchase_order_lines (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references public.pur_purchase_orders(id) on delete cascade,
  item_id     uuid not null references public.mst_items(id),
  qty         numeric(18,4) not null,
  unit_price  numeric(18,4) not null,
  tax_code    text references public.mst_tax_codes(code)
);

create table if not exists public.pur_goods_receipts (
  id             uuid primary key default gen_random_uuid(),
  doc_no         text not null unique,
  po_id          uuid not null references public.pur_purchase_orders(id),
  receipt_date   date not null default current_date,
  warehouse_code text not null references public.inv_warehouses(code),
  status         text not null default 'DRAFT' check (status in ('DRAFT','POSTED','CANCELLED'))
);

create table if not exists public.pur_goods_receipt_lines (
  id           uuid primary key default gen_random_uuid(),
  receipt_id   uuid not null references public.pur_goods_receipts(id) on delete cascade,
  po_line_id   uuid not null references public.pur_purchase_order_lines(id),
  qty          numeric(18,4) not null,
  unit_cost    numeric(18,4) not null
);

create table if not exists public.pur_vendor_bills (
  id            uuid primary key default gen_random_uuid(),
  doc_no        text not null unique,
  vendor_id     uuid not null references public.mst_parties(id),
  po_id         uuid references public.pur_purchase_orders(id),
  bill_date     date not null default current_date,
  due_date      date,
  status        text not null default 'DRAFT' check (status in ('DRAFT','POSTED','PAID','VOID')),
  subtotal      numeric(18,4) not null default 0,
  tax_amount    numeric(18,4) not null default 0,
  total         numeric(18,4) not null default 0
);

create table if not exists public.pur_vendor_bill_lines (
  id        uuid primary key default gen_random_uuid(),
  bill_id   uuid not null references public.pur_vendor_bills(id) on delete cascade,
  item_id   uuid not null references public.mst_items(id),
  qty       numeric(18,4) not null,
  unit_cost numeric(18,4) not null,
  tax_code  text references public.mst_tax_codes(code)
);

create table if not exists public.pur_payments (
  id            uuid primary key default gen_random_uuid(),
  doc_no        text not null unique,
  vendor_id     uuid not null references public.mst_parties(id),
  payment_date  date not null default current_date,
  amount        numeric(18,4) not null,
  method        text
);

create table if not exists public.pur_payment_allocations (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references public.pur_payments(id) on delete cascade,
  bill_id     uuid not null references public.pur_vendor_bills(id),
  amount      numeric(18,4) not null
);

-- =========================================================================
-- 7. General ledger
-- =========================================================================

create table if not exists public.gl_journal_entries (
  id            uuid primary key default gen_random_uuid(),
  doc_no        text not null unique,
  entry_date    date not null default current_date,
  source_module text not null,   -- 'SALES_INVOICE' | 'VENDOR_BILL' | 'MO_RECEIPT' | 'MANUAL' | ...
  source_ref    uuid,
  description   text,
  posted_by     uuid not null default auth.uid(),
  posted_at     timestamptz not null default now()
);

create table if not exists public.gl_journal_lines (
  id        uuid primary key default gen_random_uuid(),
  entry_id  uuid not null references public.gl_journal_entries(id) on delete cascade,
  account_id uuid not null references public.gl_chart_of_accounts(id),
  debit     numeric(18,4) not null default 0,
  credit    numeric(18,4) not null default 0,
  party_id  uuid references public.mst_parties(id),
  dept_code text references public.org_departments(code),
  check (debit >= 0 and credit >= 0 and not (debit > 0 and credit > 0))
);

create or replace function public.gl_check_balanced() returns trigger
language plpgsql set search_path = public as $$
declare v_diff numeric;
begin
  select coalesce(sum(debit),0) - coalesce(sum(credit),0) into v_diff
    from public.gl_journal_lines where entry_id = coalesce(new.entry_id, old.entry_id);
  if v_diff <> 0 then
    raise exception 'gl_journal_entries %: debit/credit mismatch (%).', coalesce(new.entry_id, old.entry_id), v_diff;
  end if;
  return null;
end $$;

drop trigger if exists trg_gl_check_balanced on public.gl_journal_lines;
create constraint trigger trg_gl_check_balanced
  after insert or update or delete on public.gl_journal_lines
  deferrable initially deferred
  for each row execute function public.gl_check_balanced();

-- =========================================================================
-- 8. Audit log
-- =========================================================================

create table if not exists public.aud_audit_log (
  id         bigserial primary key,
  entity     text not null,
  entity_id  text not null,
  action     text not null,
  actor      uuid not null default auth.uid(),
  at         timestamptz not null default now(),
  diff       jsonb
);

-- =========================================================================
-- 9. Row level security — baseline pattern, tighten per business rule later
-- =========================================================================

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'org_departments','org_user_roles',
      'mst_uom','mst_items','mst_parties','mst_tax_codes','mst_numbering_sequences',
      'gl_chart_of_accounts','gl_account_defaults','gl_journal_entries','gl_journal_lines',
      'inv_warehouses','inv_stock_ledger','inv_stock_balances',
      'prod_boms','prod_bom_lines','prod_routings','prod_routing_steps',
      'prod_manufacturing_orders','prod_mo_operations',
      'sal_sales_orders','sal_sales_order_lines','sal_deliveries','sal_delivery_lines',
      'sal_sales_invoices','sal_sales_invoice_lines','sal_receipts','sal_receipt_allocations',
      'pur_purchase_orders','pur_purchase_order_lines','pur_goods_receipts','pur_goods_receipt_lines',
      'pur_vendor_bills','pur_vendor_bill_lines','pur_payments','pur_payment_allocations',
      'aud_audit_log'
    ])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Master data: every signed-in user reads; only admins write.
create policy org_departments_read on public.org_departments for select to authenticated using (true);
create policy org_departments_admin_write on public.org_departments for all to authenticated
  using (public.org_is_admin()) with check (public.org_is_admin());

create policy org_user_roles_self_read on public.org_user_roles for select to authenticated
  using (user_id = auth.uid() or public.org_is_admin());
create policy org_user_roles_admin_write on public.org_user_roles for all to authenticated
  using (public.org_is_admin()) with check (public.org_is_admin());

create policy mst_read_all on public.mst_uom for select to authenticated using (true);
create policy mst_items_read on public.mst_items for select to authenticated using (true);
create policy mst_items_admin_write on public.mst_items for all to authenticated
  using (public.org_is_admin()) with check (public.org_is_admin());
create policy mst_parties_read on public.mst_parties for select to authenticated using (true);
create policy mst_parties_write on public.mst_parties for all to authenticated
  using (public.org_has_role('sales') or public.org_has_role('purchase') or public.org_is_admin())
  with check (public.org_has_role('sales') or public.org_has_role('purchase') or public.org_is_admin());
create policy mst_tax_codes_read on public.mst_tax_codes for select to authenticated using (true);
create policy mst_tax_codes_admin_write on public.mst_tax_codes for all to authenticated
  using (public.org_is_admin()) with check (public.org_is_admin());
create policy mst_numbering_read on public.mst_numbering_sequences for select to authenticated using (true);

-- GL: accounting role + admin only.
create policy gl_coa_read on public.gl_chart_of_accounts for select to authenticated using (true);
create policy gl_coa_write on public.gl_chart_of_accounts for all to authenticated
  using (public.org_is_admin()) with check (public.org_is_admin());
create policy gl_account_defaults_read on public.gl_account_defaults for select to authenticated using (true);
create policy gl_account_defaults_write on public.gl_account_defaults for all to authenticated
  using (public.org_is_admin()) with check (public.org_is_admin());
create policy gl_entries_rw on public.gl_journal_entries for all to authenticated
  using (public.org_has_role('accounting')) with check (public.org_has_role('accounting'));
create policy gl_lines_rw on public.gl_journal_lines for all to authenticated
  using (public.org_has_role('accounting')) with check (public.org_has_role('accounting'));

-- Inventory: ledger is append-only from app roles; balances are trigger-only.
create policy inv_warehouses_read on public.inv_warehouses for select to authenticated using (true);
create policy inv_warehouses_admin_write on public.inv_warehouses for all to authenticated
  using (public.org_is_admin()) with check (public.org_is_admin());
create policy inv_ledger_read on public.inv_stock_ledger for select to authenticated using (true);
create policy inv_ledger_insert on public.inv_stock_ledger for insert to authenticated
  with check (public.org_has_role('production') or public.org_has_role('sales')
              or public.org_has_role('purchase') or public.org_is_admin());
create policy inv_balances_read on public.inv_stock_balances for select to authenticated using (true);
-- No insert/update/delete policy on inv_stock_balances for authenticated: only
-- inv_apply_stock_ledger() (security definer) may write it.

-- Production: production role + admin write; everyone reads.
create policy prod_read on public.prod_boms for select to authenticated using (true);
create policy prod_write on public.prod_boms for all to authenticated
  using (public.org_has_role('production')) with check (public.org_has_role('production'));
create policy prod_bom_lines_read on public.prod_bom_lines for select to authenticated using (true);
create policy prod_bom_lines_write on public.prod_bom_lines for all to authenticated
  using (public.org_has_role('production')) with check (public.org_has_role('production'));
create policy prod_routings_read on public.prod_routings for select to authenticated using (true);
create policy prod_routings_write on public.prod_routings for all to authenticated
  using (public.org_has_role('production')) with check (public.org_has_role('production'));
create policy prod_routing_steps_read on public.prod_routing_steps for select to authenticated using (true);
create policy prod_routing_steps_write on public.prod_routing_steps for all to authenticated
  using (public.org_has_role('production')) with check (public.org_has_role('production'));
create policy prod_mo_read on public.prod_manufacturing_orders for select to authenticated using (true);
create policy prod_mo_write on public.prod_manufacturing_orders for all to authenticated
  using (public.org_has_role('production')) with check (public.org_has_role('production'));
create policy prod_mo_ops_read on public.prod_mo_operations for select to authenticated using (true);
create policy prod_mo_ops_write on public.prod_mo_operations for all to authenticated
  using (public.org_has_role('production')) with check (public.org_has_role('production'));

-- Sales: sales role + admin write; everyone reads (tighten to "own customer" later if needed).
do $$
declare t text;
begin
  for t in select unnest(array[
    'sal_sales_orders','sal_sales_order_lines','sal_deliveries','sal_delivery_lines',
    'sal_sales_invoices','sal_sales_invoice_lines','sal_receipts','sal_receipt_allocations'])
  loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated
                     using (public.org_has_role(''sales'')) with check (public.org_has_role(''sales''))', t || '_write', t);
  end loop;
end $$;

-- Purchasing: purchase role + admin write; everyone reads.
do $$
declare t text;
begin
  for t in select unnest(array[
    'pur_purchase_orders','pur_purchase_order_lines','pur_goods_receipts','pur_goods_receipt_lines',
    'pur_vendor_bills','pur_vendor_bill_lines','pur_payments','pur_payment_allocations'])
  loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated
                     using (public.org_has_role(''purchase'')) with check (public.org_has_role(''purchase''))', t || '_write', t);
  end loop;
end $$;

-- Audit log: anyone signed in can append their own row; only admins read it back.
create policy aud_insert_self on public.aud_audit_log for insert to authenticated
  with check (actor = auth.uid());
create policy aud_admin_read on public.aud_audit_log for select to authenticated
  using (public.org_is_admin());

notify pgrst, 'reload schema';
