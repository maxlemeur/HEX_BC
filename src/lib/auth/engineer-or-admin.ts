export function ensureEngineerOrAdmin(role: string) {
  if (role !== "engineer" && role !== "admin") {
    throw new Error("Accès refuse: rôle non autorise pour cette action.");
  }
}
