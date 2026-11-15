/** A `purchase_order_devis` row as the devis routes select it. */
export type DevisRecord = {
  id: string;
  created_at: string;
  name: string;
  original_filename: string;
  storage_path: string;
  file_size_bytes: number;
  mime_type: string;
  position: number;
};

export type DevisResponseItem = {
  id: string;
  name: string;
  originalFilename: string;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
  position: number;
  downloadUrl: string | null;
};

export function toDevisResponseItem(record: DevisRecord, downloadUrl: string | null): DevisResponseItem {
  return {
    id: record.id,
    name: record.name,
    originalFilename: record.original_filename,
    fileSizeBytes: record.file_size_bytes,
    mimeType: record.mime_type,
    createdAt: record.created_at,
    position: record.position,
    downloadUrl,
  };
}
