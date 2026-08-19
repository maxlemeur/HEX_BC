export function estimateEditorAutoSaveStatusClassName(status: string) {
  if (status === "saving" || status === "pending") {
    return "status-badge status-sent";
  }
  if (status === "error" || status === "offline") {
    return "status-badge status-canceled";
  }
  if (status === "saved" || status === "idle") {
    return "status-badge status-accepted";
  }
  return "status-badge status-draft";
}
