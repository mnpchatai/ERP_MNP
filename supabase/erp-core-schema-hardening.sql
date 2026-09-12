-- Follow-up to erp-core-schema.sql, written after applying that draft to a
-- scratch Supabase project and running `get_advisors` (security). Apply this
-- right after erp-core-schema.sql on any project that runs it. (The current
-- erp-core-schema.sql already includes fix #1 below directly; the
-- `create or replace` here is a harmless no-op on a fresh apply and only
-- matters for a project that ran an older copy of the base file.)
--
-- Findings fixed:
-- 1. gl_check_balanced had no locked search_path (function_search_path_mutable).
-- 2. Four SECURITY DEFINER functions were reachable via
--    /rest/v1/rpc/<name> by both `anon` and `authenticated`. This took two
--    passes to close, because it has two independent causes and revoking
--    from PUBLIC only fixes one of them:
--      - Postgres grants EXECUTE to the PUBLIC pseudo-role by default at
--        CREATE FUNCTION time.
--      - Supabase projects additionally run
--        `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO
--        anon, authenticated, service_role` (its standard PostgREST setup),
--        which grants EXECUTE to those roles BY NAME, independent of
--        PUBLIC. Revoking from PUBLIC alone leaves these named grants in
--        place, so `anon` can keep calling the function regardless.
--    Fixing it requires revoking from PUBLIC *and* the named roles, then
--    re-granting only what each function needs:
--      org_has_role / org_is_admin -> authenticated only (used inside RLS
--        policies for signed-in users; safe to call directly too, it only
--        returns a boolean about the caller's own roles).
--      mst_next_doc_no             -> authenticated only.
--      inv_apply_stock_ledger      -> nobody. Trigger-only: firing a
--        trigger does not require EXECUTE on the trigger function.

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

revoke execute on function public.org_has_role(text) from public, anon, authenticated;
revoke execute on function public.org_is_admin() from public, anon, authenticated;
revoke execute on function public.mst_next_doc_no(text) from public, anon, authenticated;
revoke execute on function public.inv_apply_stock_ledger() from public, anon, authenticated;

grant execute on function public.org_has_role(text) to authenticated;
grant execute on function public.org_is_admin() to authenticated;
grant execute on function public.mst_next_doc_no(text) to authenticated;

notify pgrst, 'reload schema';
