-- Follow-up to erp-core-schema.sql (already includes this directly — the
-- create-or-replace here is a no-op on a fresh apply). Run this on any
-- project that applied an earlier copy of the base file.
--
-- inv_apply_stock_ledger previously let a negative-qty ledger row (MO_ISSUE,
-- SO_ISSUE, TRANSFER_OUT, or an ADJUSTMENT) drive inv_stock_balances.qty_on_hand
-- below zero with no error — production.js's manufacturing-order flow could
-- issue raw material the warehouse didn't have. Fixed by raising an
-- exception when the resulting balance would go negative; the row lock the
-- function already takes (select ... for update) makes this safe under
-- concurrent issues against the same item/warehouse. Verified against the
-- real ERP_MNP project inside a transaction that was rolled back afterward:
-- issuing from a zero balance is rejected, a normal receive-then-issue
-- within balance succeeds, and issuing beyond the remaining balance is
-- rejected — with no test rows left behind.

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

notify pgrst, 'reload schema';
