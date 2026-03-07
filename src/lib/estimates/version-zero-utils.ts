export function normalizeVersionZeroLotKey(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}+/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "lot"
  );
}

export function assignVersionZeroLotKeys<T extends { label: string }>(lots: T[]) {
  const occurrenceByBaseKey = new Map<string, number>();

  return lots.map((lot) => {
    const baseKey = normalizeVersionZeroLotKey(lot.label);
    const occurrence = (occurrenceByBaseKey.get(baseKey) ?? 0) + 1;
    occurrenceByBaseKey.set(baseKey, occurrence);

    return {
      ...lot,
      key: occurrence === 1 ? baseKey : `${baseKey}-${occurrence}`,
    };
  });
}

export function matchVersionZeroLotsByLabel<
  TFallbackLot extends { label: string },
  TGeneratedLot extends { lot_label: string },
>(fallbackLots: TFallbackLot[], generatedLots: TGeneratedLot[]) {
  const generatedLotsByLabel = new Map<string, TGeneratedLot[]>();

  generatedLots.forEach((lot) => {
    const matchKey = normalizeVersionZeroLotKey(lot.lot_label);
    const bucket = generatedLotsByLabel.get(matchKey);
    if (bucket) {
      bucket.push(lot);
      return;
    }
    generatedLotsByLabel.set(matchKey, [lot]);
  });

  return fallbackLots.map((fallbackLot) => {
    const matchKey = normalizeVersionZeroLotKey(fallbackLot.label);
    const bucket = generatedLotsByLabel.get(matchKey) ?? [];
    const matchedLot = bucket.shift() ?? null;

    if (bucket.length === 0) {
      generatedLotsByLabel.delete(matchKey);
    }

    return {
      fallbackLot,
      generatedLot: matchedLot,
    };
  });
}

function normalizeLocalizedDecimalString(raw: string) {
  const withoutSpaces = raw.replace(/[\s\u00A0\u202F]/g, "").replace(/[−–—]/g, "-");
  if (!/^[+-]?[0-9][0-9,.]*$/.test(withoutSpaces)) {
    return null;
  }

  const sign = withoutSpaces.startsWith("-")
    ? "-"
    : withoutSpaces.startsWith("+")
      ? "+"
      : "";
  const unsigned = sign.length > 0 ? withoutSpaces.slice(1) : withoutSpaces;
  if (!/^\d[\d,.]*$/.test(unsigned)) {
    return null;
  }

  const hasComma = unsigned.includes(",");
  const hasDot = unsigned.includes(".");

  if (!hasComma && !hasDot) {
    return `${sign}${unsigned}`;
  }

  if (hasComma && hasDot) {
    const lastComma = unsigned.lastIndexOf(",");
    const lastDot = unsigned.lastIndexOf(".");
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const digitsOnly = unsigned.replace(/[.,]/g, "");
    const decimalIndex = decimalSeparator === "," ? lastComma : lastDot;
    const decimalLength = unsigned.length - decimalIndex - 1;

    if (decimalLength <= 0) return null;
    const integerPart = digitsOnly.slice(0, digitsOnly.length - decimalLength);
    const decimalPart = digitsOnly.slice(digitsOnly.length - decimalLength);
    if (integerPart.length === 0 || decimalPart.length === 0) {
      return null;
    }
    return `${sign}${integerPart}.${decimalPart}`;
  }

  if (hasComma) {
    const commaCount = (unsigned.match(/,/g) ?? []).length;
    if (commaCount > 1) {
      if (!/^\d{1,3}(,\d{3})+$/.test(unsigned)) {
        return null;
      }
      return `${sign}${unsigned.replace(/,/g, "")}`;
    }
    return `${sign}${unsigned.replace(",", ".")}`;
  }

  const dotCount = (unsigned.match(/\./g) ?? []).length;
  if (dotCount > 1) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(unsigned)) {
      return null;
    }
    return `${sign}${unsigned.replace(/\./g, "")}`;
  }

  return `${sign}${unsigned}`;
}

export function parseVersionZeroQuantityInput(value: string): {
  quantity: number | null;
  error: string | null;
} {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { quantity: null, error: null };
  }

  const normalized = normalizeLocalizedDecimalString(trimmed);
  if (!normalized) {
    return {
      quantity: null,
      error: "Quantite invalide. Utilisez un nombre positif, par exemple 1,5.",
    };
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      quantity: null,
      error: "Quantite invalide. Utilisez un nombre positif, par exemple 1,5.",
    };
  }

  return {
    quantity: parsed,
    error: null,
  };
}
