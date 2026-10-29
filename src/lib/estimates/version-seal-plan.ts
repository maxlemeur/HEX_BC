import { resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import {
  isUnifiedEngine,
  requireHistoricalEngine,
  usesSaleCoefficients,
} from "@/lib/estimates/engine/capabilities";
import {
  buildCanonicalEstimateSealPayload,
  computeEstimateSealHash,
  LEGACY_ESTIMATE_SEAL_PAYLOAD_VERSION,
  PREVIOUS_ESTIMATE_SEAL_PAYLOAD_VERSION,
  UNIFIED_ESTIMATE_SEAL_PAYLOAD_VERSION,
} from "@/lib/estimates/estimate-seal";

/** Charge de calcul de chaque schéma historique retrouvé par la vérification. */
const SEAL_SCHEME_PAYLOAD_VERSIONS = { v4: 4, v3: 3, v2: 2, v1_split: 1, v1_pre_split: 1 } as const;

type EstimateSealSource = Parameters<typeof buildCanonicalEstimateSealPayload>[0] & {
  version: { seal_payload_version?: number | null };
};

/** Document-bound marker 5 is verified by the offer reader before this legacy path. */
export function evaluateHistoricalEstimateSeal(sealSource: EstimateSealSource) {
  // A v3 calculation hash alone never proves an issued document seal.
  if (usesSaleCoefficients(resolveEstimateEngineVersion(sealSource.version))) {
    return {
      valid: false,
      computed_hash: computeEstimateSealHash(buildCanonicalEstimateSealPayload(sealSource)),
      stored_hash: sealSource.version.seal_hash?.trim().toLowerCase() || null,
      seal_payload_version: sealSource.version.seal_payload_version ?? null,
      client_contract_version: null,
      calc_payload_version: null,
      matched_seal_scheme: null,
    };
  }
  const currentSealCandidate = {
    scheme: "v4" as const,
    hash: computeEstimateSealHash(buildCanonicalEstimateSealPayload(sealSource)),
  };
  const previousSealCandidate = {
    scheme: "v2" as const,
    hash: computeEstimateSealHash(
      buildCanonicalEstimateSealPayload(sealSource, {
        payloadVersion: PREVIOUS_ESTIMATE_SEAL_PAYLOAD_VERSION,
      })
    ),
  };
  const unifiedSealCandidate = {
    scheme: "v3" as const,
    hash: computeEstimateSealHash(
      buildCanonicalEstimateSealPayload(sealSource, {
        payloadVersion: UNIFIED_ESTIMATE_SEAL_PAYLOAD_VERSION,
      })
    ),
  };
  const legacySealCandidates = [
    {
      scheme: "v1_split" as const,
      hash: computeEstimateSealHash(
        buildCanonicalEstimateSealPayload(sealSource, {
          payloadVersion: LEGACY_ESTIMATE_SEAL_PAYLOAD_VERSION,
          includeCalcEngineVersion: false,
        })
      ),
    },
    {
      scheme: "v1_pre_split" as const,
      hash: computeEstimateSealHash(
        buildCanonicalEstimateSealPayload(sealSource, {
          payloadVersion: LEGACY_ESTIMATE_SEAL_PAYLOAD_VERSION,
          includeLaborSplit: false,
          includeCalcEngineVersion: false,
        })
      ),
    },
  ];
  // Les nouveaux sceaux engine v2 couvrent aussi la nature de ligne et
  // l'arrondi commercial explicite en v4. Les candidats v3/v2 conservent la
  // compatibilite des sceaux emis avant ce contrat.
  const sealCandidates =
    isUnifiedEngine(requireHistoricalEngine(resolveEstimateEngineVersion(sealSource.version)))
      ? [currentSealCandidate, unifiedSealCandidate, previousSealCandidate]
      : [previousSealCandidate, ...legacySealCandidates];
  const storedHash = sealSource.version.seal_hash?.trim().toLowerCase() || null;
  const matchedCandidate =
    storedHash === null
      ? null
      : sealCandidates.find((candidate) => candidate.hash === storedHash) ?? null;
  const isValid = matchedCandidate !== null;
  // Pour un sceau historique valide, restituer le hash effectivement comparé
  // conserve le contrat existant de l'API. Pour un échec, le hash v2 courant
  // reste le diagnostic de référence.
  const computedHash = matchedCandidate?.hash ?? sealCandidates[0].hash;

  return {
    valid: isValid,
    computed_hash: computedHash,
    stored_hash: storedHash,
    seal_payload_version: sealSource.version.seal_payload_version ?? null,
    client_contract_version: null,
    calc_payload_version: matchedCandidate ? SEAL_SCHEME_PAYLOAD_VERSIONS[matchedCandidate.scheme] : null,
    matched_seal_scheme: matchedCandidate?.scheme ?? null,
  };
}
