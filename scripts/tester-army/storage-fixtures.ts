import { checked, sqlTransport, type CalcV3FixtureContext } from "./calc-v3-fixtures";

// Owned native prerequisites only. Existing incompatible buckets fail closed.
export async function ensureSourceReferenceBucket(context: CalcV3FixtureContext) {
  sqlTransport(context);
  const id = "estimate-source-references", maximumBytes = 50 * 1024 * 1024;
  const buckets = await checked("source reference bucket inventory", context.admin.storage.listBuckets());
  if (!buckets.some((bucket) => bucket.id === id)) {
    await checked("source reference private bucket", context.admin.storage.createBucket(id, {
      public: false, fileSizeLimit: maximumBytes, allowedMimeTypes: ["application/pdf"],
    }));
  }
  const bucket = await checked("source reference bucket readback", context.admin.storage.getBucket(id));
  if (bucket.id !== id || bucket.public || bucket.file_size_limit !== maximumBytes ||
      JSON.stringify(bucket.allowed_mime_types) !== JSON.stringify(["application/pdf"])) {
    throw new Error("Owned source reference bucket differs from its private PDF contract.");
  }
  return { id: bucket.id, public: bucket.public, maximumBytes: bucket.file_size_limit, allowedMimeTypes: bucket.allowed_mime_types };
}
