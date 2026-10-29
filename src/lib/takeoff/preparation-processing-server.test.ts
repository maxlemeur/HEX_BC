import { describe, expect, it } from "vitest";
import { takeoffPreparationSchema } from "@/lib/takeoff/preparation";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";
import { assertReplayedTakeoffProcessing, assertTakeoffPreparationProcessing } from "@/lib/takeoff/preparation-processing-server";

describe("confirmed takeoff processing choices", () => {
  it("reads old drafts as unset without inventing a level or explicit provider", () => {
    const legacy = { ...confirmedPreparationFixture().preparation };
    Reflect.deleteProperty(legacy, "processing");
    const preparation = takeoffPreparationSchema.parse(legacy);
    expect(preparation.processing).toEqual({ level: null, provider: "auto" });
    expect(takeoffPreparationSchema.parse({ ...legacy, processing: null }).processing).toEqual({ level: null, provider: "auto" });
    expect(() => assertTakeoffPreparationProcessing(preparation, { level: "B", provider: "auto" })).toThrow("Choisissez le niveau");
  });

  it.each(["B", "C"] as const)("keeps level %s and explicit ChatGPT through serialization and reload", (level) => {
    const preparation = confirmedPreparationFixture().preparation;
    preparation.processing = { level, provider: "chatgpt" };
    const reloaded = takeoffPreparationSchema.parse(JSON.parse(JSON.stringify(preparation)));
    expect(reloaded.processing).toEqual({ level, provider: "chatgpt" });
    expect(() => assertTakeoffPreparationProcessing(reloaded, { level, provider: "chatgpt" })).not.toThrow();
    expect(() => assertTakeoffPreparationProcessing(reloaded, { level: level === "B" ? "C" : "B", provider: "chatgpt" })).toThrow("réglages de traitement");
    expect(() => assertTakeoffPreparationProcessing(reloaded, { level, provider: "gemini" })).toThrow("réglages de traitement");
  });

  it("checks the immutable job snapshot before reusing a prepared receipt", () => {
    const snapshot = confirmedPreparationFixture();
    snapshot.preparation.processing = { level: "B", provider: "auto" };
    expect(() => assertReplayedTakeoffProcessing({ preparation_snapshot: snapshot }, { level: "B", provider: "auto" })).not.toThrow();
    expect(() => assertReplayedTakeoffProcessing({ preparation_snapshot: snapshot }, { level: "C", provider: "auto" })).toThrow("réglages de traitement");
    expect(() => assertReplayedTakeoffProcessing({ preparation_snapshot: snapshot }, { level: "B", provider: "gemini" })).toThrow("réglages de traitement");
  });

  it("allows historical null and old snapshots to replay while new launches require settings", () => {
    const snapshot = confirmedPreparationFixture();
    expect(() => assertReplayedTakeoffProcessing({ preparation_snapshot: null }, { level: "A", provider: "gemini" })).not.toThrow();
    expect(() => assertReplayedTakeoffProcessing({ preparation_snapshot: snapshot }, { level: "C", provider: "chatgpt" })).not.toThrow();
    const legacySnapshot = JSON.parse(JSON.stringify(snapshot));
    legacySnapshot.preparation.processing = null;
    expect(() => assertReplayedTakeoffProcessing({ preparation_snapshot: legacySnapshot }, { level: "B", provider: "auto" })).not.toThrow();
  });
});
