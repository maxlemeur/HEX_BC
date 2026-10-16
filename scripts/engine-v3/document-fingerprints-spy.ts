import * as documentData from "@/components/estimate-document/prepare-estimate-document-data";

/**
 * Observation wrapper of the real document preparer, substituted only inside
 * the fingerprint worker by its resolve hook. It calls the real function with
 * the arguments the real PDF generator built and returns its result
 * untouched; it only records a copy while the worker holds an open sink.
 * This module imports the real one through the same alias: the hook never
 * redirects an import whose parent is this file.
 */
export * from "@/components/estimate-document/prepare-estimate-document-data";

type PrepareInput = Parameters<typeof documentData.prepareEstimateDocumentData>[0];
type PrepareOutput = ReturnType<typeof documentData.prepareEstimateDocumentData>;

export type PreparedDocumentObservation = {
  input: PrepareInput;
  output: PrepareOutput;
};

const SINK_KEY = "__ENGINE_FINGERPRINT_PREPARED__";
const SPY_MARK = Symbol.for("engine-fingerprint.prepare-spy");
type GlobalWithSink = typeof globalThis & { [SINK_KEY]?: PreparedDocumentObservation[] };
type MaybeSpy = typeof documentData.prepareEstimateDocumentData & { [SPY_MARK]?: true };

export const prepareEstimateDocumentData: MaybeSpy = Object.assign((input: PrepareInput): PrepareOutput => {
  const delegate = documentData.prepareEstimateDocumentData as MaybeSpy;
  const output = delegate(input);
  // A second instance of this module would wrap the first one: only the
  // innermost wrapper records, so one real call is always one observation.
  const sink = (globalThis as GlobalWithSink)[SINK_KEY];
  // structuredClone keeps the breakdown Maps and detaches the record from any
  // later mutation by the caller.
  if (sink && !delegate[SPY_MARK]) sink.push(structuredClone({ input, output }));
  return output;
}, { [SPY_MARK]: true as const });

/** Collect the real preparer calls made while `run` executes. */
export async function observePreparedDocuments<T>(run: () => Promise<T>) {
  const holder = globalThis as GlobalWithSink;
  if (holder[SINK_KEY]) throw new Error("Prepared-document observations cannot be nested.");
  const observations: PreparedDocumentObservation[] = [];
  holder[SINK_KEY] = observations;
  try {
    const result = await run();
    return { result, observations };
  } finally {
    delete holder[SINK_KEY];
  }
}
