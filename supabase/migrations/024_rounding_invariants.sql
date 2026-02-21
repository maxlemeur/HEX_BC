-- EST-026: enforce rounding invariants and scoped invariant-violation audit writes.

alter table public.estimate_versions
  drop constraint if exists estimate_versions_total_ttc_gte_total_ht_check;

alter table public.estimate_versions
  add constraint estimate_versions_total_ttc_gte_total_ht_check
  check (
    total_ht_cents is null
    or total_ttc_cents is null
    or total_ttc_cents >= total_ht_cents
  );

alter table public.estimate_versions
  drop constraint if exists estimate_versions_total_tax_nonnegative_check;

alter table public.estimate_versions
  add constraint estimate_versions_total_tax_nonnegative_check
  check (
    total_tax_cents is null
    or total_tax_cents >= 0
  );

alter table public.estimate_versions
  drop constraint if exists estimate_versions_totals_consistent_check;

alter table public.estimate_versions
  add constraint estimate_versions_totals_consistent_check
  check (
    total_ht_cents is null
    or total_tax_cents is null
    or total_ttc_cents is null
    or total_ttc_cents = total_ht_cents + total_tax_cents
  );

alter table public.estimate_items
  drop constraint if exists estimate_items_line_total_ttc_gte_ht_check;

alter table public.estimate_items
  add constraint estimate_items_line_total_ttc_gte_ht_check
  check (
    line_total_ht_cents is null
    or line_total_ttc_cents is null
    or line_total_ttc_cents >= line_total_ht_cents
  );

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check
  check (action in ('INSERT', 'UPDATE', 'DELETE', 'invariant_violation'));

drop policy if exists "Server can insert invariant violation audit logs" on public.audit_logs;

create policy "Server can insert invariant violation audit logs"
  on public.audit_logs
  for insert
  to authenticated
  with check (
    action = 'invariant_violation'
    and user_id = (select auth.uid())
    and table_name in ('estimate_versions', 'estimate_items')
    and estimate_version_id is not null
    and exists (
      select 1
      from public.estimate_versions ev
      join public.estimate_projects ep
        on ep.id = ev.project_id
       and ep.tenant_id = ev.tenant_id
      where ev.id = audit_logs.estimate_version_id
        and ev.tenant_id = audit_logs.tenant_id
        and (select public.is_tenant_member(ev.tenant_id))
        and (
          ep.user_id = (select auth.uid())
          or (select public.has_tenant_role(ev.tenant_id, array['admin'::public.tenant_role]))
        )
    )
    and (
      (table_name = 'estimate_versions' and record_id = estimate_version_id)
      or (
        table_name = 'estimate_items'
        and exists (
          select 1
          from public.estimate_items ei
          where ei.id = audit_logs.record_id
            and ei.version_id = audit_logs.estimate_version_id
            and ei.tenant_id = audit_logs.tenant_id
        )
      )
    )
  );
