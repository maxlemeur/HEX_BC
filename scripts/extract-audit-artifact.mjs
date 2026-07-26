// Regenere docs/user_story/AUDIT-2026-07-inventaire.md depuis l export HTML de
// l artefact d audit.
//
//   node scripts/extract-audit-artifact.mjs <artefact.html> <sortie.md>
//
// Conserve pour que l inventaire reste reproductible si l artefact evolue. Les
// statuts de rapprochement (constante STATUTS) sont saisis a la main : les
// reporter ici plutot que dans le markdown, sinon une regeneration les efface.
// Extrait l'audit (27 bugs + 73 constats UX) de l'artefact HTML vers un
// inventaire markdown exploitable et versionnable.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync(process.argv[2], "utf8");

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
  B06: "à traiter — T6 phase E, étape 17",
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
  B17: "à traiter — T6 phase E, étape 17",
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
  UX01: "livré (`c0ceefe`) — colonnes Deboursé sec / Marge € / Marque %",
};

const esc = (s) => (s || "").replace(/\|/g, "\\|");
const trunc = (s, n) => {
  const v = esc(s);
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

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
  "> **Statut du rapprochement.** Les **27 bugs** sont rapproches un a un des"
);
out.push(
  "> correctifs livres (§1). Les **73 constats UX/UI** ne le sont PAS encore, sauf"
);
out.push(
  "> UX01 : ils valent `a traiter` par defaut, ce qui ne prouve pas qu ils soient"
);
out.push("> ouverts — seulement que personne n a verifie. Voir §3.");
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
      `| ${u.id} | ${esc(u.severite)} | ${trunc(u.surface, 45)} | ${trunc(u.observation, 180)} | ${STATUTS[u.id] ?? "à traiter"} |`
    );
  }
  out.push("");
}
out.push("---");
out.push("");
out.push("## 3. Ce qui reste a rapprocher");
out.push("");
out.push(
  "Les 27 bugs sont traites. Restent **72 constats UX/UI** dont le statut n a pas ete"
);
out.push(
  "verifie contre le code : c est le premier vrai jalon de « finir l audit UX/UI », et"
);
out.push("il se fait constat par constat, pas en bloc.");
out.push("");
out.push("Pour retrouver les correctifs livres :");
out.push("");
out.push("```bash");
out.push("git log --oneline e6d4ed2^..HEAD");
out.push("```");
out.push("");
out.push(
  "Marquer chaque ligne `livre (<sha>)`, `partiel (<sha>) — <ce qui reste>`,"
);
out.push(
  "`a traiter` ou `ecarte — <raison>`. Un constat laisse ouvert sans raison"
);
out.push("explicite est un constat perdu.");
out.push("");

writeFileSync(process.argv[3], out.join("\n"), "utf8");
console.log(
  `bugs=${bugs.length} ux=${ux.length} personas=${personaNames.length} -> ${process.argv[3]}`
);
