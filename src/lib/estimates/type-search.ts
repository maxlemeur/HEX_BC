export type EstimateTypeOption = {
  id: string;
  code?: string;
  label: string;
  detail?: string;
  disabled?: boolean;
};

export function normalizeTypeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function searchEstimateTypes(
  options: readonly EstimateTypeOption[],
  query: string,
): EstimateTypeOption[] {
  const needle = normalizeTypeSearch(query);
  if (!needle) return [...options];
  return options.map((option, index) => {
    const code = normalizeTypeSearch(option.code ?? "");
    const label = normalizeTypeSearch(option.label);
    const rank = code === needle ? 0
      : code.startsWith(needle) ? 1
        : label === needle ? 2
          : label.split(/\s+/).some((word) => word.startsWith(needle)) ? 3
            : code.includes(needle) || label.includes(needle) ? 4 : 5;
    return { option, rank, index };
  }).filter(({ rank }) => rank < 5)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ option }) => option);
}

/** Never infer a selection from the first item of an ambiguous result list. */
export function resolveUniqueEstimateType(
  options: readonly EstimateTypeOption[],
  query: string,
): EstimateTypeOption | undefined {
  const needle = normalizeTypeSearch(query);
  if (!needle) return undefined;
  const matches = searchEstimateTypes(options, query).filter((option) => !option.disabled);
  const exactCodes = matches.filter((option) => option.code && normalizeTypeSearch(option.code) === needle);
  if (exactCodes.length === 1) return exactCodes[0];
  return matches.length === 1 ? matches[0] : undefined;
}
