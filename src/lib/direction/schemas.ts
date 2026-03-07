export const DIRECTION_HORIZON_VALUES = [
  "all",
  "this_week",
  "this_month",
] as const;

export type DirectionDashboardHorizon =
  (typeof DIRECTION_HORIZON_VALUES)[number];

export type DirectionDashboardQuery = {
  ownerUserId: string | null;
  lot: string | null;
  horizon: DirectionDashboardHorizon;
  onlyExceptions: boolean;
};

function normalizeStringParam(
  value: string | string[] | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isHorizon(value: string | null): value is DirectionDashboardHorizon {
  return Boolean(
    value &&
      (DIRECTION_HORIZON_VALUES as readonly string[]).includes(value)
  );
}

export function parseDirectionDashboardQuery(
  params: Record<string, string | string[] | undefined>
): DirectionDashboardQuery {
  const ownerUserId = normalizeStringParam(params.owner);
  const lot = normalizeStringParam(params.lot);
  const rawHorizon = normalizeStringParam(params.horizon);
  const rawExceptions = normalizeStringParam(params.onlyExceptions);

  return {
    ownerUserId,
    lot,
    horizon: isHorizon(rawHorizon) ? rawHorizon : "all",
    onlyExceptions: rawExceptions === "true",
  };
}
