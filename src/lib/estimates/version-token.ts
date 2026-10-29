// PostgreSQL timestamps retain microseconds, beyond Date.parse's milliseconds.
function timestampMicroseconds(value: string) {
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d\d:?\d\d)$/)?.[1] ?? "";
  return Date.parse(value) * 1000 + Number(fraction.padEnd(6, "0").slice(3, 6));
}

export function isOlderEstimateVersionToken(candidate: string, current: string) {
  return timestampMicroseconds(candidate) < timestampMicroseconds(current);
}

export function sameEstimateVersionToken(left: string, right: string) {
  const a = timestampMicroseconds(left);
  const b = timestampMicroseconds(right);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}
