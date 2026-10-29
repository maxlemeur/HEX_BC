import { useState } from "react";

export const scenarios = [
  { id: "dossier", label: "Dossier à cadrer", stage: "Cadrage" },
  { id: "etude", label: "Chiffrage en cours", stage: "Étude" },
  { id: "remise", label: "Devis à envoyer", stage: "Remise" },
  { id: "achats", label: "Devis accepté", stage: "Achats" },
] as const;
export type Scenario = (typeof scenarios)[number]["id"];
export type Surface = "documents" | "brief" | "registre" | "devis" | "remise" | "achats" | "activite" | "exports";

export const lines = [
  { label: "Réseau eau froide", quantity: 120, unit: "ml", price: 4250, supplier: "Distribution Fluides" },
  { label: "Réseau évacuation", quantity: 80, unit: "ml", price: 6800, supplier: "Distribution Fluides" },
  { label: "Ensembles sanitaires", quantity: 16, unit: "u", price: 45000, supplier: "Sanitaires Services" },
  { label: "Main-d’œuvre de pose", quantity: 120, unit: "h", price: 5200, supplier: null },
];
export const totalHtCents = lines.reduce((sum, line) => sum + line.quantity * line.price, 0);
export const supplierGroups = [
  { name: "Distribution Fluides", lines: 2, cents: 1054000 },
  { name: "Sanitaires Services", lines: 1, cents: 720000 },
];
const documentNames = [
  "Plan des réseaux — rez-de-chaussée.pdf", "Plan des réseaux — sous-sol.pdf",
  ...Array.from({ length: 12 }, (_, i) => `Plan des réseaux — étage ${i + 1}.pdf`),
  "CCTP — plomberie sanitaire.pdf", "Notice de sécurité.pdf", "Planning de consultation.pdf",
  "Plan de repérage des équipements.pdf", "Règlement de consultation.pdf",
];
export const documents = documentNames.map((name, id) => ({ id, name, category: id < 14 || id === 17 ? "Plans" : id === 14 ? "CCTP" : "Annexes" }));

export function useDemo(scenario: Scenario) {
  const [validIds, setValidIds] = useState<number[]>(scenario === "dossier" ? [0, 1] : documents.map((doc) => doc.id));
  const [categories, setCategories] = useState<Record<number, string>>({});
  const [briefConfirmed, setBriefConfirmed] = useState(scenario !== "dossier");
  const [issueResolved, setIssueResolved] = useState(scenario !== "dossier");
  const [reviewed, setReviewed] = useState(scenario === "remise" || scenario === "achats");
  const [pdfReady, setPdfReady] = useState(scenario === "achats");
  const [sent, setSent] = useState(scenario === "achats");
  const [ordersCreated, setOrdersCreated] = useState(false);
  const [surface, setSurface] = useState<Surface | null>(null);
  const pending = documents.length - validIds.length;
  const primary: { title: string; description: string; action: string; surface: Surface } = scenario === "dossier"
    ? pending > 0
      ? { title: "Vérifier les documents reçus", description: `${pending} pièces restent à classer avant de confirmer le périmètre de l’étude.`, action: "Ouvrir les documents", surface: "documents" }
      : !issueResolved
        ? { title: "Clarifier la pièce attendue", description: "L’annexe technique du CCTP reste à obtenir ou à arbitrer.", action: "Traiter ce point", surface: "registre" }
        : { title: "Confirmer le brief de l’affaire", description: "Relisez le périmètre et les hypothèses avant de démarrer le chiffrage.", action: "Relire le brief", surface: "brief" }
    : scenario === "etude"
      ? { title: reviewed ? "Le chiffrage est relu" : "Finaliser le chiffrage", description: reviewed ? "Les quantités et les prix sont vérifiés. Vous pouvez préparer la remise." : "Vérifiez les quantités et les prix des quatre postes du devis.", action: "Ouvrir le devis", surface: "devis" }
      : scenario === "remise"
        ? { title: sent ? "Le devis a été envoyé" : "Préparer l’envoi au client", description: sent ? "La réponse du client est attendue. Le document envoyé reste consultable." : "Les contrôles métier sont levés. Préparez le PDF, puis vérifiez votre email.", action: sent ? "Consulter l’envoi" : "Préparer la remise", surface: "remise" }
        : { title: ordersCreated ? "Les achats sont préparés" : "Préparer les commandes fournisseurs", description: ordersCreated ? "Deux brouillons sont disponibles pour la suite des achats." : "Le devis est accepté. Trois lignes peuvent être regroupées en deux commandes.", action: ordersCreated ? "Consulter les brouillons" : "Préparer les achats", surface: "achats" };
  return { scenario, pending, validIds, setValidIds, categories, setCategories, briefConfirmed, setBriefConfirmed,
    issueResolved, setIssueResolved, reviewed, setReviewed, pdfReady, setPdfReady, sent, setSent,
    ordersCreated, setOrdersCreated, surface, setSurface, primary };
}
export type Demo = ReturnType<typeof useDemo>;
