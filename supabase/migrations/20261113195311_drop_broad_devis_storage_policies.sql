-- Purchase-order documents (bucket devis) are reached only through the tenant- and author-scoped storage policies of
-- 20260708120000_harden_devis_storage_policies.sql and 20260713140454_harden_estimate_procurement_write_roles.sql.
--
-- A shared database was found on 13/11/2026 to hold four more policies on storage.objects that no migration creates:
-- devis_read, devis_insert, devis_update and devis_delete, for authenticated, on bucket_id = 'devis' alone. Permissive
-- policies combine with OR, so they let any signed-in member of any tenant list, read, overwrite or delete every
-- tenant's purchase-order documents. They are dropped here; a database without them is unchanged.
--
-- Regression: supabase/tests/database/devis-storage-isolation.test.sql and the bucket devis invariant of
-- supabase/tests/database/security-invariants.test.sql.
drop policy if exists devis_read on storage.objects;
drop policy if exists devis_insert on storage.objects;
drop policy if exists devis_update on storage.objects;
drop policy if exists devis_delete on storage.objects;
