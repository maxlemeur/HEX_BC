-- Add covering indexes for remaining foreign keys flagged by Supabase advisor.

create index if not exists dpgf_catalogue_links_import_id_idx
  on public.dpgf_catalogue_links (import_id);
create index if not exists dpgf_catalogue_links_mapped_row_id_idx
  on public.dpgf_catalogue_links (mapped_row_id);

create index if not exists estimate_approvals_rule_id_idx
  on public.estimate_approvals (rule_id);
create index if not exists estimate_approvals_version_id_idx
  on public.estimate_approvals (version_id);

create index if not exists estimate_templates_created_by_idx
  on public.estimate_templates (created_by);

create index if not exists estimate_version_changelogs_project_id_idx
  on public.estimate_version_changelogs (project_id);

create index if not exists suggestion_learning_reviews_rule_id_idx
  on public.suggestion_learning_reviews (rule_id);

create index if not exists supplier_pricebook_product_id_idx
  on public.supplier_pricebook (product_id);
create index if not exists supplier_pricebook_supplier_id_idx
  on public.supplier_pricebook (supplier_id);
