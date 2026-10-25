-- No migration revoked the default EXECUTE on insert_estimate_template_into_version,
-- so PUBLIC and anon could still call it; the body only refuses a null auth.uid().
-- Match the assembly writer (20260722132425): drop PUBLIC and anon, keep authenticated
-- explicitly, and leave service_role on its Supabase default grant (20261010010645).
revoke execute on function public.insert_estimate_template_into_version(
  uuid, uuid, uuid
) from public, anon;

grant execute on function public.insert_estimate_template_into_version(
  uuid, uuid, uuid
) to authenticated;
