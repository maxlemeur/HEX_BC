-- Application validation restricts binary originals to DWG/DXF/RVT extensions
-- and their known MIME aliases. Preserve the private bucket, size and policies.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/octet-stream')
where id = 'affaire-intake'
  and allowed_mime_types is not null
  and not ('application/octet-stream' = any(allowed_mime_types));
