type AffaireCountersRow = {
  total_count: unknown;
  filtered_count: unknown;
  draft_count: unknown;
  sending_count: unknown;
  sent_count: unknown;
  accepted_count: unknown;
  archived_count: unknown;
};

function toSafeCount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function normalizeAffaireCounters(row: AffaireCountersRow) {
  const filteredCount = toSafeCount(row.filtered_count);
  const draft = toSafeCount(row.draft_count);
  const sending = toSafeCount(row.sending_count);
  const sent = toSafeCount(row.sent_count);
  const accepted = toSafeCount(row.accepted_count);
  const archived = toSafeCount(row.archived_count);

  return {
    totalCount: toSafeCount(row.total_count),
    filteredCount,
    statusCounts: {
      draft,
      sending,
      sent,
      accepted,
      archived,
    },
  };
}
