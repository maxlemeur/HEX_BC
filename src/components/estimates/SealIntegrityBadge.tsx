export type SealIntegrityState = "valid" | "invalid" | "unsealed" | "error";

type SealIntegrityBadgeProps = {
  state: SealIntegrityState;
  hashPrefix?: string | null;
};

function getBadgeLabel(state: SealIntegrityState, hashPrefix?: string | null) {
  if (state === "valid") {
    if (hashPrefix) {
      return `Scelle (${hashPrefix})`;
    }
    return "Scelle";
  }

  if (state === "invalid") {
    return "Integrite compromise";
  }

  if (state === "error") {
    return "Verification indisponible";
  }

  return "Non scelle";
}

function getBadgeClass(state: SealIntegrityState) {
  if (state === "valid") return "status-badge status-confirmed";
  if (state === "invalid") return "status-badge status-canceled";
  if (state === "error") return "status-badge status-sent";
  return "status-badge status-draft";
}

export function SealIntegrityBadge({
  state,
  hashPrefix = null,
}: Readonly<SealIntegrityBadgeProps>) {
  return (
    <span className={getBadgeClass(state)} title="Integrite du chiffrage">
      {getBadgeLabel(state, hashPrefix)}
    </span>
  );
}
