import { describe, expect, it } from "vitest";

import {
  getTakeoffEscalationModelConfig,
  getTakeoffLevelConfig,
  getTakeoffModelConfig,
  getTakeoffPrompt,
  getTakeoffPromptRuntimeConfig,
  getTakeoffPromptVersion,
  TAKEOFF_LEVEL_MODEL_MATRIX,
  TAKEOFF_PROMPT_VERSION_BY_LEVEL,
} from "@/lib/takeoff/prompts";

describe("takeoff prompts", () => {
  it("matches snapshot for level A prompt", () => {
    const prompt = getTakeoffPrompt("A", {
      fileType: "csv",
      schemaVersion: "v1",
      sourceHint: "upload-a.csv",
    });

    expect(prompt).toMatchInlineSnapshot(`
      "ROLE
      Tu es un moteur d'extraction takeoff BTP pour estimation de cout.

      CONTEXTE
      - level: A
      - prompt_version: takeoff-a-v1
      - file_type: csv
      - schema_version: v1
      - source: upload-a.csv

      OBJECTIF METIER
      Produire un quantitatif exploitable rapidement a partir des elements clairs du document.

      CONTRAINTES STRICTES TakeoffExchangeSchema
      1. La sortie DOIT etre un objet JSON strictement compatible avec TakeoffExchangeSchema.
      2. Racine obligatoire: items (array), warnings (array), metadata (objet).
      3. metadata obligatoire: level, prompt_version, file_type, schema_version.
      4. Toujours renseigner metadata.level avec le niveau demande sans deviation.
      5. Toujours renseigner metadata.prompt_version avec la version attendue pour le niveau.
      6. Interdiction d'ajouter des champs hors schema; aucun champ inconnu n'est autorise.
      7. items[*] obligatoire: designation (string), quantity (>0), unit (string).
      8. warnings[*] doit respecter code/message/severity, avec severity dans info|warning|error.
      9. Renvoyer du JSON pur uniquement, sans markdown, sans commentaire, sans texte hors JSON.

      REGLES WARNINGS ET ANOMALIES
      1. Chaque incertitude doit produire un warning explicite avec un code stable en MAJUSCULES.
      2. Utiliser item_index et table_index quand la source de l'anomalie est connue.
      3. severity=warning pour ambiguite ou deduction, severity=error pour donnee incoherente bloquante.
      4. Si une valeur est impossible a determiner de facon fiable, ne pas inventer; preferer un warning.
      5. Conserver un tableau warnings meme vide: [] si aucune anomalie detectee.

      REGLES NIVEAU A
      1. Niveau A: extraction rapide des items principaux avec precision raisonnable.
      2. tables est optionnel au niveau A; si absent, ne pas ajouter de table vide inutile.

      CONSIGNES DE SORTIE
      1. Prioriser la couverture metier des postes principaux sans surestimer les quantites.
      2. Chaque item doit rester traceable vers le contenu source quand possible (source_page/source_file).

      FINAL
      Retourne exclusivement un JSON valide conforme au schema, sans texte additionnel."
    `);
  });

  it("matches snapshot for level B prompt", () => {
    const prompt = getTakeoffPrompt("B", {
      fileType: "xlsx",
      schemaVersion: "v1",
      sourceHint: "upload-b.xlsx",
    });

    expect(prompt).toMatchInlineSnapshot(`
      "ROLE
      Tu es un moteur d'extraction takeoff BTP pour estimation de cout.

      CONTEXTE
      - level: B
      - prompt_version: takeoff-b-v1
      - file_type: xlsx
      - schema_version: v1
      - source: upload-b.xlsx

      OBJECTIF METIER
      Produire un quantitatif detaille avec extraction structuree des tableaux detectes.

      CONTRAINTES STRICTES TakeoffExchangeSchema
      1. La sortie DOIT etre un objet JSON strictement compatible avec TakeoffExchangeSchema.
      2. Racine obligatoire: items (array), warnings (array), metadata (objet).
      3. metadata obligatoire: level, prompt_version, file_type, schema_version.
      4. Toujours renseigner metadata.level avec le niveau demande sans deviation.
      5. Toujours renseigner metadata.prompt_version avec la version attendue pour le niveau.
      6. Interdiction d'ajouter des champs hors schema; aucun champ inconnu n'est autorise.
      7. items[*] obligatoire: designation (string), quantity (>0), unit (string).
      8. warnings[*] doit respecter code/message/severity, avec severity dans info|warning|error.
      9. Renvoyer du JSON pur uniquement, sans markdown, sans commentaire, sans texte hors JSON.

      REGLES WARNINGS ET ANOMALIES
      1. Chaque incertitude doit produire un warning explicite avec un code stable en MAJUSCULES.
      2. Utiliser item_index et table_index quand la source de l'anomalie est connue.
      3. severity=warning pour ambiguite ou deduction, severity=error pour donnee incoherente bloquante.
      4. Si une valeur est impossible a determiner de facon fiable, ne pas inventer; preferer un warning.
      5. Conserver un tableau warnings meme vide: [] si aucune anomalie detectee.

      REGLES NIVEAU B
      1. Niveau B: tables est requis et doit contenir au moins un tableau exploitable.
      2. Pour chaque table: page>0, headers non vides, rows non vides, row_index >= 0.

      CONSIGNES DE SORTIE
      1. Synchroniser les items avec les lignes detectees dans tables quand applicable.
      2. Signaler tout ecart entre tableaux et items via warnings explicites.

      FINAL
      Retourne exclusivement un JSON valide conforme au schema, sans texte additionnel."
    `);
  });

  it("matches snapshot for level C prompt", () => {
    const prompt = getTakeoffPrompt("C", {
      fileType: "xlsx",
      schemaVersion: "v1",
      sourceHint: "upload-c.xlsx",
    });

    expect(prompt).toMatchInlineSnapshot(`
      "ROLE
      Tu es un moteur d'extraction takeoff BTP pour estimation de cout.

      CONTEXTE
      - level: C
      - prompt_version: takeoff-c-v1
      - file_type: xlsx
      - schema_version: v1
      - source: upload-c.xlsx

      OBJECTIF METIER
      Produire un quantitatif auditable avec indicateurs de confiance et preuves par item.

      CONTRAINTES STRICTES TakeoffExchangeSchema
      1. La sortie DOIT etre un objet JSON strictement compatible avec TakeoffExchangeSchema.
      2. Racine obligatoire: items (array), warnings (array), metadata (objet).
      3. metadata obligatoire: level, prompt_version, file_type, schema_version.
      4. Toujours renseigner metadata.level avec le niveau demande sans deviation.
      5. Toujours renseigner metadata.prompt_version avec la version attendue pour le niveau.
      6. Interdiction d'ajouter des champs hors schema; aucun champ inconnu n'est autorise.
      7. items[*] obligatoire: designation (string), quantity (>0), unit (string).
      8. warnings[*] doit respecter code/message/severity, avec severity dans info|warning|error.
      9. Renvoyer du JSON pur uniquement, sans markdown, sans commentaire, sans texte hors JSON.

      REGLES WARNINGS ET ANOMALIES
      1. Chaque incertitude doit produire un warning explicite avec un code stable en MAJUSCULES.
      2. Utiliser item_index et table_index quand la source de l'anomalie est connue.
      3. severity=warning pour ambiguite ou deduction, severity=error pour donnee incoherente bloquante.
      4. Si une valeur est impossible a determiner de facon fiable, ne pas inventer; preferer un warning.
      5. Conserver un tableau warnings meme vide: [] si aucune anomalie detectee.

      REGLES NIVEAU C
      1. Niveau C: confidence global est requis pour le niveau C.
      2. Niveau C: items[*].confidence est requis pour chaque item au niveau C.
      3. Niveau C: source_page est requis pour chaque item au niveau C.
      4. Niveau C: evidence est requis pour chaque item au niveau C.
      5. confidence global et items[*].confidence doivent etre entre 0 et 1.
      6. Chaque evidence doit decrire la source de preuve de facon concise et verifiable.

      CONSIGNES DE SORTIE
      1. Maximiser la tracabilite: justifier les dedutions avec evidence et warnings associes.
      2. En cas de doute fort, reduire confidence et expliquer l'anomalie dans warnings.

      FINAL
      Retourne exclusivement un JSON valide conforme au schema, sans texte additionnel."
    `);
  });

  it("includes mandatory confidence, source_page and evidence instructions for level C", () => {
    const prompt = getTakeoffPrompt("C", {
      fileType: "xlsx",
      schemaVersion: "v1",
    });

    expect(prompt).toContain("Niveau C: confidence global est requis pour le niveau C.");
    expect(prompt).toContain("Niveau C: items[*].confidence est requis pour chaque item au niveau C.");
    expect(prompt).toContain("Niveau C: source_page est requis pour chaque item au niveau C.");
    expect(prompt).toContain("Niveau C: evidence est requis pour chaque item au niveau C.");
  });

  it("returns explicit prompt_version per level", () => {
    expect(getTakeoffPromptVersion("A")).toBe("takeoff-a-v1");
    expect(getTakeoffPromptVersion("B")).toBe("takeoff-b-v1");
    expect(getTakeoffPromptVersion("C")).toBe("takeoff-c-v1");

    expect(TAKEOFF_PROMPT_VERSION_BY_LEVEL).toEqual({
      A: "takeoff-a-v1",
      B: "takeoff-b-v1",
      C: "takeoff-c-v1",
    });
  });

  it("uses centralized matrix level -> model -> thinkingLevel", () => {
    expect(TAKEOFF_LEVEL_MODEL_MATRIX).toEqual({
      A: { model: "gemini-3.1-flash-lite-preview", thinkingLevel: "low" },
      B: { model: "gemini-3-flash-preview", thinkingLevel: "medium" },
      C: { model: "gemini-3.1-pro-preview", thinkingLevel: "high" },
    });

    expect(getTakeoffModelConfig("A")).toEqual({
      model: "gemini-3.1-flash-lite-preview",
      thinkingLevel: "low",
    });
    expect(getTakeoffModelConfig("B")).toEqual({
      model: "gemini-3-flash-preview",
      thinkingLevel: "medium",
    });
    expect(getTakeoffModelConfig("C")).toEqual({
      model: "gemini-3.1-pro-preview",
      thinkingLevel: "high",
    });
  });

  it("returns full level config for runtime usage", () => {
    expect(getTakeoffLevelConfig("A")).toEqual({
      level: "A",
      promptVersion: "takeoff-a-v1",
      model: "gemini-3.1-flash-lite-preview",
      thinkingLevel: "low",
    });

    expect(getTakeoffLevelConfig("B")).toEqual({
      level: "B",
      promptVersion: "takeoff-b-v1",
      model: "gemini-3-flash-preview",
      thinkingLevel: "medium",
    });

    expect(getTakeoffLevelConfig("C")).toEqual({
      level: "C",
      promptVersion: "takeoff-c-v1",
      model: "gemini-3.1-pro-preview",
      thinkingLevel: "high",
    });
  });

  it("declares explicit fallback/escalation models where needed", () => {
    expect(getTakeoffEscalationModelConfig("A")).toEqual({
      model: "gemini-3-flash-preview",
      thinkingLevel: "low",
      reason: "Fallback when Flash-Lite produces invalid structured output.",
    });
    expect(getTakeoffEscalationModelConfig("B")).toEqual({
      model: "gemini-3.1-pro-preview",
      thinkingLevel: "medium",
      reason: "Fallback when Flash extraction is ambiguous or structurally weak.",
    });
    expect(getTakeoffEscalationModelConfig("C")).toBeNull();
  });

  it("returns merged runtime config with final prompt", () => {
    const runtimeConfig = getTakeoffPromptRuntimeConfig("C", {
      fileType: "xlsx",
      schemaVersion: "v1",
      sourceHint: "runtime-file.xlsx",
    });

    expect(runtimeConfig.level).toBe("C");
    expect(runtimeConfig.promptVersion).toBe("takeoff-c-v1");
    expect(runtimeConfig.model).toBe("gemini-3.1-pro-preview");
    expect(runtimeConfig.thinkingLevel).toBe("high");
    expect(runtimeConfig.prompt).toContain("- source: runtime-file.xlsx");
    expect(runtimeConfig.prompt).toContain("Niveau C: confidence global est requis pour le niveau C.");
  });
});
