export function selectDpgfSheetIndex(
  sheetNames: string[],
  sheetMatrices: unknown[][][]
) {
  function normalizeSheetCell(value: unknown) {
    if (value === null || value === undefined) return "";

    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function scorePotentialDpgfHeader(row: unknown[]) {
    const cells = row.map((value) => normalizeSheetCell(value)).filter(Boolean);
    if (cells.length === 0) return 0;

    const matches = (aliases: string[]) =>
      cells.some((cell) =>
        aliases.some((alias) =>
          cell === alias || (alias.length >= 3 && cell.includes(alias))
        )
      );

    let score = 0;
    if (
      matches(["designation", "description", "libelle", "ouvrage", "prestation"])
    ) {
      score += 2;
    }
    if (matches(["qte", "qty", "quantite", "quantity"])) score += 4;
    if (matches(["u", "unite", "unit"])) score += 3;
    if (
      matches([
        "pr fo",
        "prfo",
        "prix fourniture",
        "prix fournisseur",
        "prix unitaire",
        "unit price",
        "pu",
      ])
    ) {
      score += 4;
    }
    if (
      matches(["h mo", "heures mo", "heure mo", "labor hours", "temps mo"])
    ) {
      score += 3;
    }
    if (matches(["commentaire", "comment", "notes", "observation"])) score += 1;

    return score;
  }

  if (sheetNames.length === 0) return -1;

  let bestIndex = 0;
  let bestScore = -1;

  for (let sheetIndex = 0; sheetIndex < sheetNames.length; sheetIndex += 1) {
    const matrix = Array.isArray(sheetMatrices[sheetIndex])
      ? sheetMatrices[sheetIndex]
      : [];
    let sheetScore = 0;

    for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 30); rowIndex += 1) {
      const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
      sheetScore = Math.max(sheetScore, scorePotentialDpgfHeader(row));
    }

    if (sheetScore > bestScore) {
      bestIndex = sheetIndex;
      bestScore = sheetScore;
    }
  }

  return bestIndex;
}
