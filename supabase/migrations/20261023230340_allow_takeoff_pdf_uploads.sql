-- Levels B/C accept PDFs, but the original upload bucket only allowed spreadsheets.
-- Keep existing formats, privacy, limits and tenant-scoped object policies intact.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/pdf')
where id = 'takeoff-files'
  and allowed_mime_types is not null
  and not ('application/pdf' = any(allowed_mime_types));
