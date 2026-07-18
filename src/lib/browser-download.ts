export const BLOB_DOWNLOAD_REVOKE_DELAY_MS = 60_000;

export function downloadBlob(blob: Blob, filename: string) {
  if (
    typeof document === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  link.remove();

  globalThis.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, BLOB_DOWNLOAD_REVOKE_DELAY_MS);
}
