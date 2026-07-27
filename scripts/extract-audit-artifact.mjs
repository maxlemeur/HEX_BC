// Regénère docs/user_story/AUDIT-2026-07-inventaire.md depuis :
//
//   - la source canonique normalisée JSON versionnée dans docs/user_story ;
//   - l'export HTML historique, lorsqu'il est disponible.
//
//   node scripts/extract-audit-artifact.mjs <source.json|artefact.html> <sortie.md>
//   node scripts/extract-audit-artifact.mjs --normalize-ledger <ledger.md> <source.json>
//
// Le JSON normalisé n'est PAS une copie de l'HTML brut (indisponible dans le
// dépôt). Il porte l'inventaire contrôlable et la représentation ligne par ligne
// du ledger publié, suffisante pour une régénération exacte et stable.
//
// En mode HTML, les statuts de rapprochement (constante STATUTS) restent saisis
// ici : les reporter ici plutôt que dans le markdown, sinon une régénération
// depuis l'ancien artefact les efface.
// Extrait l'audit (27 bugs + 73 constats UX) de l'artefact HTML vers un
// inventaire markdown exploitable et versionnable.
import { readFileSync, writeFileSync } from "node:fs";

const parseTableCells = (line) =>
  line
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll("\\|", "|"));

const collectNormalizedInventory = (markdown) => {
  const lines = markdown.split("\n");
  const bugs = [];
  const ux = [];
  let currentPersona = null;

  for (const line of lines) {
    const personaMatch = line.match(/^### (.+) — \d+ constats$/);
    if (personaMatch) {
      currentPersona = personaMatch[1];
      continue;
    }

    if (/^\| B\d{2} \|/.test(line)) {
      const [id, severite, domaine, emplacement, titre, statut] =
        parseTableCells(line);
      bugs.push({ id, severite, domaine, emplacement, titre, statut });
      continue;
    }

    if (/^\| UX\d{2} \|/.test(line)) {
      const [id, severite, surface, observation, statut] =
        parseTableCells(line);
      ux.push({
        id,
        persona: currentPersona,
        severite,
        surface,
        observation,
        statut,
      });
    }
  }

  const campaignStart = lines.findIndex((line) =>
    line.startsWith("### Campagne d'accents FR")
  );
  const campaignEnd =
    campaignStart < 0
      ? -1
      : lines.findIndex(
          (line, index) =>
            index > campaignStart && /^Les \d+ restants/.test(line)
        );

  return {
    bugs,
    ux,
    campaign:
      campaignStart < 0
        ? null
        : {
            heading: lines[campaignStart],
            lines: lines.slice(
              campaignStart,
              campaignEnd < 0 ? lines.length : campaignEnd
            ),
          },
  };
};

const renderCanonicalSource = (source) => {
  if (
    source?.schema_version !== 1 ||
    source?.source_kind !== "normalized_audit_ledger" ||
    !Array.isArray(source?.document?.lines) ||
    typeof source?.document?.final_newline !== "boolean" ||
    !Array.isArray(source?.inventory?.bugs) ||
    !Array.isArray(source?.inventory?.ux)
  ) {
    throw new Error("Source canonique d'audit invalide.");
  }

  const expectedBugCount = source.expected_counts?.bugs;
  const expectedUxCount = source.expected_counts?.ux;
  if (
    source.inventory.bugs.length !== expectedBugCount ||
    source.inventory.ux.length !== expectedUxCount
  ) {
    throw new Error("Compteurs de la source canonique d'audit incohérents.");
  }

  const uniqueBugIds = new Set(source.inventory.bugs.map((bug) => bug.id));
  const uniqueUxIds = new Set(source.inventory.ux.map((item) => item.id));
  if (
    uniqueBugIds.size !== expectedBugCount ||
    uniqueUxIds.size !== expectedUxCount
  ) {
    throw new Error("Identifiants dupliqués dans la source canonique d'audit.");
  }

  const markdown = source.document.lines.join("\n");
  const rendered = `${markdown}${source.document.final_newline ? "\n" : ""}`;
  const renderedInventory = collectNormalizedInventory(rendered);
  if (
    renderedInventory.bugs.length !== expectedBugCount ||
    renderedInventory.ux.length !== expectedUxCount
  ) {
    throw new Error("Le document canonique ne correspond pas à son inventaire.");
  }
  if (
    JSON.stringify(renderedInventory) !== JSON.stringify(source.inventory)
  ) {
    throw new Error(
      "L'inventaire normalisé diverge du document canonique publié."
    );
  }

  return rendered;
};

const args = process.argv.slice(2);

if (args[0] === "--normalize-ledger") {
  const ledgerPath = args[1];
  const sourcePath = args[2];
  if (!ledgerPath || !sourcePath) {
    throw new Error(
      "Usage: --normalize-ledger <ledger.md> <source.json>"
    );
  }

  const markdown = readFileSync(ledgerPath, "utf8");
  const inventory = collectNormalizedInventory(markdown);
  const source = {
    schema_version: 1,
    source_kind: "normalized_audit_ledger",
    provenance: {
      normalized_from: "docs/user_story/AUDIT-2026-07-inventaire.md",
      original_artifact_url:
        "https://claude.ai/code/artifact/91124126-27a6-4450-ac6d-b9b7745b0403",
      original_html_available: false,
      note:
        "Source normalisée fidèle au ledger publié ; ce fichier n'est pas l'HTML brut de l'artefact.",
    },
    expected_counts: {
      bugs: inventory.bugs.length,
      ux: inventory.ux.length,
    },
    inventory,
    document: {
      lines: markdown.endsWith("\n")
        ? markdown.slice(0, -1).split("\n")
        : markdown.split("\n"),
      final_newline: markdown.endsWith("\n"),
    },
  };

  writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
  console.log(
    `normalized bugs=${inventory.bugs.length} ux=${inventory.ux.length} -> ${sourcePath}`
  );
  process.exit(0);
}

const inputPath = args[0];
const outputPath = args[1];
if (!inputPath || !outputPath) {
  throw new Error(
    "Usage: <source.json|artefact.html> <sortie.md>"
  );
}

const input = readFileSync(inputPath, "utf8");
if (inputPath.endsWith(".json")) {
  const source = JSON.parse(input);
  const markdown = renderCanonicalSource(source);
  writeFileSync(outputPath, markdown, "utf8");
  console.log(
    `bugs=${source.inventory.bugs.length} ux=${source.inventory.ux.length} source=normalized -> ${outputPath}`
  );
  process.exit(0);
}

const html = input;

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;|&#8217;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const pick = (block, re) => {
  const m = block.match(re);
  return m ? decode(m[1]) : "";
};

// ---------- bugs ----------
const bugBlocks = html.split('<article class="card bug').slice(1);
const bugs = bugBlocks.map((raw, index) => {
  const block = raw.slice(0, raw.indexOf("</article>"));
  const statuses = [...block.matchAll(/class="status[^"]*">([^<]+)</g)].map((m) =>
    decode(m[1])
  );
  return {
    id: `B${String(index + 1).padStart(2, "0")}`,
    severite: pick(block, /data-sev="([^"]+)"/) || pick(block, /class="sev[^"]*">([^<]+)</),
    theme: pick(block, /class="tag">([^<]+)</),
    statut: statuses.join(" · "),
    domaine: pick(block, /class="cluster">([^<]+)</),
    titre: pick(block, /class="bug-title">([\s\S]*?)<\/h3>/),
    emplacement: pick(block, /class="loc"><code>([\s\S]*?)<\/code>/),
    description: pick(block, /class="desc">([\s\S]*?)<\/p>/),
  };
});

// ---------- constats UX, par persona ----------
const personaNames = [
  ...html.matchAll(/<h3>([^<]{3,80})<\/h3>\s*<div class="pcounts"/g),
].map((m) => decode(m[1]));

const personaBlocks = html.split('<section class="persona"').slice(1);
const ux = [];
personaBlocks.forEach((rawPersona, personaIndex) => {
  const persona = personaNames[personaIndex] ?? `Persona ${personaIndex + 1}`;
  const items = rawPersona.split('<div class="ux ').slice(1);
  items.forEach((raw) => {
    const end = raw.indexOf('<div class="ux ');
    const block = end === -1 ? raw : raw.slice(0, end);
    ux.push({
      id: `UX${String(ux.length + 1).padStart(2, "0")}`,
      persona,
      severite: pick(block, /class="sev[^"]*">([^<]+)</),
      theme: pick(block, /class="tag">([^<]+)</),
      surface: pick(block, /class="area">([^<]+)</),
      observation: pick(block, /class="ux-obs">([\s\S]*?)<\/p>/),
      preuve: pick(block, /class="ux-ev">([\s\S]*?)<\/div>/),
      reco: pick(block, /class="ux-reco">([\s\S]*?)<\/p>/),
    });
  });
});

// Rapprochement manuel avec les correctifs livrés les 23-25/07, établi en
// relisant chaque constat contre `git log`. Tout ce qui n'est pas listé ici
// reste `à traiter` — l'absence de statut n'est jamais une preuve d'absence de
// correctif, elle signifie que le rapprochement n'a pas été fait.
const STATUTS = {
  B01: "partiel (`6cba58d`) — l'écrêtage est signalé au TOTAL, pas au niveau LIGNE",
  B02: "livré (`91b9906`)",
  B03: "livré (`5d21030` préselection + `7977a53` sélection manuelle)",
  B04: "livré (`12550bc`)",
  B05: "livré (`1a58046`)",
  B06: "traité (lot correctif 2026-07-27) — lignes et Résumé XLSX réconciliés sans bascule forcée du moteur",
  B07: "corrigé en moteur v2 (`8092b29`, `966db09`) mais **le gate n'est pas basculé**",
  B08: "livré (`ee5b242`)",
  B09: "livré (`26332ba`)",
  B10: "partiel (`b12b277`) — l'application partielle est signalée, sans rollback",
  B11: "livré (`b74a0c8`, corrigé ensuite par `b27b290` qui invalidait tous les sceaux)",
  B12: "à traiter — T3(a), classement encore multi-devises",
  B13: "livré (`1d7ae68`)",
  B14: "livré (`c211dbb`)",
  B15: "livré (`ec13f18`)",
  B16: "livré (`ee5b242`)",
  B17: "traité (lot correctif 2026-07-27) — coefficient, remise et arrondi TTC répartis sur les lignes exportées",
  B18: "livré (`e905d6d`)",
  B19: "livré (`6c5b5cc`)",
  B20: "livré (`a4d87c5`, étendu par `6b3521f` à patchEstimateVersion et duplicate)",
  B21: "à traiter — T1b",
  B22: "à traiter — T1b, sous-partie template",
  B23: "livré (`3c529ee`)",
  B24: "livré (`30a8b85`)",
  B25: "livré (`976f23f`)",
  B26: "écarté — vérifié CORRECT : un montant a deux décimales, « 2.500 » y vaut bien 2500 (cf. T16)",
  B27: "à traiter — absorbé par le breakdown T6 (`puNetHtCents`)",
  // --- Constats UX rapproches le 2026-07-26 ---------------------------------
  //
  // Methode : pour chaque constat, la reference de code de l'audit a ete
  // rouverte au HEAD. « livre » = le defaut n'est plus la, avec le sha qui l'a
  // corrige. « a traiter (verifie) » = le defaut est TOUJOURS present, constate
  // dans le code, pas suppose.
  //
  // Les constats sans mention explicite portent le statut par defaut, qui dit
  // ce qu'il vaut : aucun correctif de la plage livree ne les vise, et ils
  // n'ont pas ete rouverts un a un.
  UX01: "livré (`c0ceefe`) — colonnes Deboursé sec / Marge € / Marque %",
  UX02: "à traiter (vérifié) — `grandTotals` filtre encore `item_type !== \"section\"`, les lignes racine restent hors du pied",
  UX03: "à traiter (vérifié) — aucun raccourci de création de ligne dans `useEstimateKeyboardShortcuts`",
  UX04: "à traiter (vérifié) — `mod()` toujours présent dans `useSpreadsheetNavigation`, la navigation boucle",
  UX05: "livré (`3d5aaab`) — `confirmAndBulkDeleteSelection` confirme avant suppression",
  UX06: "livré (`1a58046`) — un champ vidé retombe sur 1 (neutre) et non sur 0",
  UX08: "livré (`9259f03`) — la case porte `onKeyDown` et `onClick`, opérable au clavier",
  UX10: "**traité** (`6935dba`, `6865076`, `0e28d25`) — éditeur, messages d'erreur et centre de métrés ; garde `src/lib/i18n/fr-accents.test.ts`",
  UX23: "**traité** (`6935dba`) — les exemples cités sont corrigés ; TakeoffReviewPage/Table sous garde",
  UX28: "livré (`12d77a8`) — piège de focus et restauration sur EvidencePanel",
  UX33: "à traiter (vérifié) — `EstimateDashboard` n'est importé nulle part, toujours mort",
  UX34: "**traité** (`ce532c0`) — panneau de flux, intake, brouillons de commandes et suggestions cockpit sous garde",
  UX41: "livré (`e10b045`) — plus de `force:true` codé en dur dans « Marquer envoyé »",
  UX44: "à traiter (vérifié) — `onDirectionToggle={() => {}}` toujours no-op dans ApprovalQueuePage",
  UX51: "livré (`8a685cf`) — la clé `_freshnessLevel` a disparu, le filtre fonctionne",
  UX52: "**traité** (`157fe00`, complété le 2026-07-27) — comparateur fournisseurs, import CSV price book, catalogue et mapping sous garde",
  UX53: "livré (`ce09a53`) — fermeture par Échap et focus initial",
  UX55: "livré (`30a8b85` affichage par devise + `7977a53` sélection manuelle bloquée)",
  UX59: "à traiter (vérifié) — `aging` n'existe que dans les options de filtre, pas dans les stats",
  UX64: "**traité** (lot correctif 2026-07-27) — le snapshot CGV/exclusions validé est affiché et contrôlé fail-closed à l'acceptation",
  UX65: "**traité** (lot correctif 2026-07-27) — l'action d'impression reste disponible avant et après décision",
  UX66: "livré (`5503cd7`) — accents rétablis sur le portail et le document client",
  UX67: "à traiter (vérifié) — pages `expired` / `not-found` sans coordonnées émetteur",
  UX68: "**traité** (lot correctif 2026-07-27) — layout stocké et émetteur du document sont transmis au portail, avec fallback legacy",
};

const esc = (s) => (s || "").replace(/\|/g, "\\|");
const trunc = (s, n) => {
  const v = esc(s);
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

const resolveUxStatus = (id) =>
  STATUTS[id] ?? "à traiter — non rouvert, aucun correctif livré ne le vise";
const closedUxCount = ux.filter((item) =>
  /^(livré|\*\*traité\*\*)/.test(resolveUxStatus(item.id))
).length;
const verifiedOpenUxCount = ux.filter((item) =>
  resolveUxStatus(item.id).startsWith("à traiter (vérifié)")
).length;
const unopenedUxCount = ux.length - closedUxCount - verifiedOpenUxCount;

const ACCENT_CAMPAIGN_SECTION = [
  "### Campagne d'accents FR (UX10, UX23, UX34, UX52) — close sur les surfaces principales",
  "",
  "Les quatre constats visaient le même défaut sur quatre parcours. Sur 552",
  "libellés suspects au départ, 252 sont corrigés ; les 300 restants sont",
  "concentrés hors des écrans visés : `lib/openapi/registry.ts` (39, descriptions",
  "de doc API jamais affichées), `lib/takeoff/server.ts` (36),",
  "`lib/estimates/generated-ouvrages.ts` (16).",
  "",
  "Le gain est verrouillé par `src/lib/i18n/fr-accents.test.ts`, qui liste les",
  "fichiers réellement relus et échoue si l'un régresse. **La liste s'étend",
  "fichier par fichier, jamais en bloc** : une substitution automatique mot à mot",
  "a été essayée puis abandonnée — sur 1170 chaînes elle francisait des noms de",
  "tests anglais (« source details » → « source détails ») et laissait des",
  "phrases à moitié corrigées (« déjà verrouillee »). Le garde a trouvé 21",
  "fautes que la relecture manuelle avait manquées ; c'est lui qui fait",
  "converger la campagne.",
  "",
  "Le 2026-07-27, la garde a été étendue à `CatalogueManager`,",
  "`MappingRuleEditor` et `TakeoffTableView` après correction des libellés encore",
  "non accentués découverts par la revue des commits.",
  "",
  "Deux pièges à connaître avant de reprendre le chantier :",
  "",
  "- Les tokens courts sont préfixes d'autres mots (« Termine » de « Terminer »,",
  "  « Reference » de « References »). Ils se remplacent guillemets compris.",
  "- Un en-tête de colonne dans une fixture de test (« Designation » dans un",
  "  collage Excel simulé) est de la **donnée**, pas un libellé. L'accentuer",
  "  affaiblit le test. La distinction ne se mécanise pas.",
  "",
];

const out = [];
out.push("# Audit produit du 2026-07-23 — inventaire versionné");
out.push("");
out.push(
  "> **Pourquoi ce fichier existe.** L'audit (27 bugs vérifiés + 73 constats UX/UI par"
);
out.push(
  "> persona) ne vivait que dans un artefact externe. Tant qu'il n'était pas dans le"
);
out.push("> dépôt, « finir l'audit UX/UI » n'était pas mesurable et une perte d'accès");
out.push("> aurait effacé le travail. Rapatrié le 2026-07-25.");
out.push(">");
out.push("> Source : `https://claude.ai/code/artifact/91124126-27a6-4450-ac6d-b9b7745b0403`");
out.push(">");
out.push(
  "> **Statut du rapprochement.** Les **27 bugs** et **24 des 73 constats UX/UI**"
);
out.push(
  "> ont été rapprochés du code AU HEAD : la référence de l'audit a été rouverte,"
);
out.push(
  "> et le statut dit si le défaut est encore là, ou quel commit l'a corrigé."
);
out.push(
  "> Les 49 autres portent un statut qui dit exactement ce qu'il vaut — non"
);
out.push(
  "> rouverts, aucun correctif livré ne les vise. Ce n'est pas une preuve qu'ils"
);
out.push("> soient ouverts, seulement que personne n'a vérifié. Voir §3.");
out.push("");
out.push(`Généré depuis l'artefact : **${bugs.length} bugs**, **${ux.length} constats UX/UI**.`);
out.push("");
out.push("---");
out.push("");
out.push("## 1. Bugs vérifiés");
out.push("");
out.push("| ID | Gravité | Domaine | Emplacement | Constat | Statut |");
out.push("|---|---|---|---|---|---|");
for (const b of bugs) {
  out.push(
    `| ${b.id} | ${esc(b.severite)} | ${trunc(b.domaine, 40)} | \`${esc(b.emplacement)}\` | ${trunc(b.titre, 150)} | ${STATUTS[b.id] ?? "à traiter"} |`
  );
}
out.push("");
out.push("### Détail des bugs");
out.push("");
for (const b of bugs) {
  out.push(`#### ${b.id} — ${b.titre}`);
  out.push("");
  out.push(`- **Gravité** : ${b.severite} · **Thème** : ${b.theme} · **Vérification** : ${b.statut}`);
  out.push(`- **Domaine** : ${b.domaine}`);
  out.push(`- **Emplacement** : \`${b.emplacement}\``);
  out.push(`- ${b.description}`);
  out.push("");
}
out.push("---");
out.push("");
out.push("## 2. Constats UX/UI par persona");
out.push("");
for (const persona of personaNames) {
  const items = ux.filter((u) => u.persona === persona);
  if (items.length === 0) continue;
  out.push(`### ${persona} — ${items.length} constats`);
  out.push("");
  out.push("| ID | Gravité | Surface | Observation | Statut |");
  out.push("|---|---|---|---|---|");
  for (const u of items) {
    out.push(
      `| ${u.id} | ${esc(u.severite)} | ${trunc(u.surface, 45)} | ${trunc(u.observation, 160)} | ${resolveUxStatus(u.id)} |`
    );
  }
  out.push("");
}
out.push("---");
out.push("");
out.push("## 3. Ce qui reste à rapprocher");
out.push("");
out.push("Bilan du rapprochement UX au 2026-07-27 :");
out.push("");
out.push("| Statut | Nombre |");
out.push("|---|---|");
out.push(`| livré ou traité, avec sa preuve | ${closedUxCount} |`);
out.push(`| à traiter — **vérifié** encore ouvert dans le code | ${verifiedOpenUxCount} |`);
out.push(`| non rouvert | ${unopenedUxCount} |`);
out.push("");
out.push(...ACCENT_CAMPAIGN_SECTION);
out.push(
  `Les ${unopenedUxCount} restants sont en majorité des améliorations de conception`
);
out.push(
  "(visualiseur de plan, dates de pilotage, écarts chiffres, architecture"
);
out.push(
  "d’information) qu’aucun commit de la plage livrée ne vise. Les rouvrir un à"
);
out.push(
  "un reste à faire, mais le risque d’en trouver un déjà corrigé est faible."
);
out.push("");
out.push("Pour retrouver les correctifs livrés :");
out.push("");
out.push("```bash");
out.push("git log --oneline e6d4ed2^..HEAD");
out.push("```");
out.push("");
out.push(
  "Marquer chaque ligne `livré (<sha>)`, `partiel (<sha>) — <ce qui reste>`,"
);
out.push(
  "`à traiter` ou `écarté — <raison>`. Un constat laissé ouvert sans raison"
);
out.push("explicite est un constat perdu.");
out.push("");

writeFileSync(outputPath, out.join("\n"), "utf8");
console.log(
  `bugs=${bugs.length} ux=${ux.length} personas=${personaNames.length} source=html -> ${outputPath}`
);
