-- Keep structured DPGF imports available only to authenticated callers.
revoke execute on function public.create_estimate_version_from_import_lines(
  uuid,
  uuid,
  text,
  text,
  jsonb
) from public, anon;

grant execute on function public.create_estimate_version_from_import_lines(
  uuid,
  uuid,
  text,
  text,
  jsonb
) to authenticated;
