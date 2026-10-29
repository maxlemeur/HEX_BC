import { useState, type ReactNode } from "react";
import { ArrowRight, Check, ChevronRight, ClipboardList, FileText, FolderOpen, Mail, PackageCheck } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatEUR } from "@/lib/money";
import { documents, lines, scenarios, supplierGroups, totalHtCents, type Demo, type Scenario, type Surface } from "./model";

export function Action({ children, onClick, quiet = false, disabled = false }: {
  children: ReactNode; onClick: () => void; quiet?: boolean; disabled?: boolean;
}) {
  return <button type="button" className={`pc-button ${quiet ? "pc-secondary" : "pc-primary"}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Tag({ children, success = false }: { children: ReactNode; success?: boolean }) {
  return <span className={`pc-tag ${success ? "pc-tag-success" : ""}`}>{children}</span>;
}

export function Heading({ demo }: { demo: Demo }) {
  return <header className="pc-heading">
    <div><div className="pc-breadcrumb">Affaires <ChevronRight size={12} /> Résidence des Tilleuls</div>
      <h1>Résidence des Tilleuls <Tag>{scenarios.find((item) => item.id === demo.scenario)?.stage}</Tag></h1>
      <p>Plomberie · Immeuble collectif · TIL-026</p></div>
    <button className="pc-button pc-secondary" onClick={() => demo.setSurface("documents")}><FolderOpen size={15} /> Documents</button>
  </header>;
}

export function StageRail({ scenario }: { scenario: Scenario }) {
  const current = scenarios.findIndex((item) => item.id === scenario);
  return <ol className="pc-stage-rail" aria-label="Avancement de l’affaire">
    {scenarios.filter((stage) => stage.id !== "achats" || scenario === "achats").map((stage, index) => <li key={stage.id} aria-current={index === current ? "step" : undefined} className={index < current ? "pc-stage-done" : ""}>
      <span>{index < current ? <Check size={13} /> : index + 1}</span>{stage.stage}
    </li>)}
  </ol>;
}

export function PrimaryAction({ demo, compact = false, onOpen }: { demo: Demo; compact?: boolean; onOpen?: (surface: Surface) => void }) {
  const Icon = demo.scenario === "dossier" ? FolderOpen : demo.scenario === "etude" ? ClipboardList : demo.scenario === "remise" ? Mail : PackageCheck;
  return <div className={`pc-next ${compact ? "pc-next-compact" : ""}`}>
    <span className="pc-eyebrow">{demo.sent && demo.scenario === "remise" ? "SUIVI CLIENT" : "À FAIRE MAINTENANT"}</span>
    <div className="pc-next-icon"><Icon size={23} strokeWidth={1.6} /></div>
    <h2>{demo.primary.title}</h2><p>{demo.primary.description}</p>
    <Action onClick={() => (onOpen ?? demo.setSurface)(demo.primary.surface)}>{demo.primary.action}<ArrowRight size={15} /></Action>
  </div>;
}

export function Issue({ demo }: { demo: Demo }) {
  if (demo.scenario !== "dossier" || demo.issueResolved || demo.primary.surface === "registre") return null;
  return <button className="pc-issue" onClick={() => demo.setSurface("registre")}>
    <span className="pc-issue-dot" /><span><strong>Une pièce attendue à arbitrer</strong><small>Annexe technique du CCTP non reçue</small></span><ChevronRight size={16} />
  </button>;
}

export function Facts({ demo }: { demo: Demo }) {
  const planCount = documents.filter((doc) => demo.validIds.includes(doc.id) && (demo.categories[doc.id] ?? doc.category) === "Plans").length;
  return <div className="pc-facts">
    <span className="pc-eyebrow">REPÈRES DU DOSSIER</span>
    <dl><div><dt>Documents reçus</dt><dd>19 pièces</dd></div><div><dt>Plans confirmés</dt><dd>{planCount} plan{planCount > 1 ? "s" : ""}</dd></div>
      <div><dt>Brief</dt><dd>{demo.briefConfirmed ? "Confirmé" : "À confirmer"}</dd></div>
      {demo.scenario !== "dossier" ? <><div><dt>Version du devis</dt><dd>V1 · {demo.scenario === "achats" ? "Acceptée" : demo.sent ? "Envoyée" : "Brouillon"}</dd></div><div><dt>Total HT</dt><dd>{formatEUR(totalHtCents)}</dd></div></> : null}</dl>
    <button className="pc-text-button" onClick={() => demo.setSurface("brief")}>Consulter le brief <ArrowRight size={13} /></button>
  </div>;
}

export function Activity() {
  return <ul className="pc-activity"><li><Check size={14} /><span>Deux plans confirmés et disponibles pour le métré<small>Aujourd’hui · 10:40</small></span></li><li><FileText size={14} /><span>Brief proposé à partir des pièces reçues<small>Aujourd’hui · 10:35</small></span></li><li><FolderOpen size={14} /><span>Dossier de consultation reçu · 19 documents<small>Aujourd’hui · 10:30</small></span></li></ul>;
}

export function DocumentWorkspace({ demo }: { demo: Demo }) {
  const [active, setActive] = useState(2);
  const [selected, setSelected] = useState<number[]>([]);
  const doc = documents[active];
  const valid = demo.validIds.includes(active);
  const allSelected = selected.length === documents.length;
  function validate(ids: number[]) {
    demo.setValidIds((prior) => [...new Set([...prior, ...ids])]);
    setSelected([]);
    const next = documents.find((item) => !demo.validIds.includes(item.id) && !ids.includes(item.id));
    if (next) setActive(next.id);
  }
  return <div className="pc-document-workspace">
    <div className="pc-document-list">
      <div className="pc-list-toolbar"><strong>{demo.pending} pièces à vérifier</strong><label><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : documents.map((item) => item.id))} />Tout sélectionner</label></div>
      {selected.length > 0 ? <div className="pc-selection"><Action onClick={() => validate(selected)}>Valider la sélection ({selected.length})</Action></div> : null}
      <div className="pc-document-scroll"><table><thead><tr><th><span className="sr-only">Sélection</span></th><th>Document</th><th>État</th></tr></thead><tbody>{documents.map((item) => <tr key={item.id} className={active === item.id ? "pc-row-active" : ""}>
        <td><input aria-label={`Sélectionner ${item.name}`} type="checkbox" checked={selected.includes(item.id)} onChange={() => setSelected((prior) => prior.includes(item.id) ? prior.filter((id) => id !== item.id) : [...prior, item.id])} /></td>
        <td><button title={item.name} onClick={() => setActive(item.id)}>{item.name}</button></td><td>{demo.validIds.includes(item.id) ? <Tag success>Validé</Tag> : <Tag>À vérifier</Tag>}</td>
      </tr>)}</tbody></table></div>
    </div>
    <aside className="pc-document-preview"><span className="pc-eyebrow">APERÇU LATÉRAL</span><h3>{doc.name}</h3>
      <div className="pc-paper"><div className="pc-paper-brand">TILLEULS / CONSULTATION</div><h4>{doc.category === "Plans" ? "PLAN DES RÉSEAUX" : "PIÈCE DU DOSSIER"}</h4><div className="pc-plan-grid"><span>EF</span><span>EU</span><span>Collecteur</span></div><p>Document d’exemple · Révision B</p></div>
      <label className="pc-field">Catégorie<select value={demo.categories[active] ?? doc.category} onChange={(event) => demo.setCategories((prior) => ({ ...prior, [active]: event.target.value }))}>{["Plans", "CCTP", "DPGF", "BPU / DQE", "Devis fournisseur", "Note technique", "Annexes"].map((name) => <option key={name}>{name}</option>)}</select></label>
      <Action disabled={valid} onClick={() => validate([active])}>{valid ? "Pièce validée" : "Valider cette pièce"}<Check size={14} /></Action>
    </aside>
  </div>;
}

function EstimateWorkspace({ demo, advance }: { demo: Demo; advance: (scenario: Scenario) => void }) {
  return <div className="pc-workspace-content"><p>Version 1 · Quatre postes de chiffrage</p><div className="pc-table-overflow"><table className="pc-estimate-table"><thead><tr><th>Désignation</th><th>Quantité</th><th>Prix unitaire HT</th><th>Total HT</th></tr></thead><tbody>{lines.map((line) => <tr key={line.label}><td>{line.label}</td><td>{line.quantity} {line.unit}</td><td>{formatEUR(line.price)}</td><td>{formatEUR(line.price * line.quantity)}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>Total HT</td><td>{formatEUR(totalHtCents)}</td></tr></tfoot></table></div>
    {demo.scenario === "etude" ? <><label className="pc-check"><input type="checkbox" checked={demo.reviewed} onChange={(event) => demo.setReviewed(event.target.checked)} />J’ai vérifié les quantités et les prix.</label>
      <Action disabled={!demo.reviewed} onClick={() => { demo.setSurface(null); advance("remise"); }}>Passer à la remise <ArrowRight size={14} /></Action></> : <p className="pc-note">Version {demo.scenario === "achats" ? "acceptée" : demo.sent ? "envoyée" : "relue pour la remise"} · consultation du chiffrage.</p>}
  </div>;
}

function OutputWorkspace({ demo }: { demo: Demo }) {
  const [composing, setComposing] = useState(false);
  return <div className="pc-workspace-content">
    <div className="pc-output-summary"><div><span className="pc-eyebrow">DEVIS V1</span><strong>{formatEUR(totalHtCents)} HT</strong></div><Tag success>{demo.scenario === "achats" ? "Accepté" : demo.sent ? "Envoyé" : "Validation interne obtenue"}</Tag></div>
    <div className="pc-check-row"><Check size={18} /><span>Documents et points du registre vérifiés</span></div>
    <div className="pc-check-row"><FileText size={18} /><span>{demo.pdfReady ? "PDF de la version 1 prêt" : "PDF à préparer"}</span>{!demo.pdfReady ? <Action quiet onClick={() => demo.setPdfReady(true)}>Préparer le PDF</Action> : <Tag success>Prêt</Tag>}</div>
    {demo.sent ? <div className="pc-confirmation"><Check size={19} /><div><strong>{demo.scenario === "achats" ? "Devis accepté par le client" : "Envoi confirmé"}</strong><p>{demo.scenario === "achats" ? "L’accord client est enregistré sur la version 1." : "Le devis V1 est envoyé. La réponse du client reste attendue."}</p></div></div> : composing ? <form className="pc-send-form" onSubmit={(event) => { event.preventDefault(); demo.setSent(true); }}>
      <label className="pc-field">Destinataire<input type="email" required defaultValue="consultation@example.com" /></label>
      <label className="pc-field">Objet<input required defaultValue="Devis plomberie — Résidence des Tilleuls" /></label>
      <label className="pc-field">Message<textarea required defaultValue="Bonjour, veuillez trouver notre devis en pièce jointe. Cordialement." /></label>
      <p className="pc-muted">Simulation : aucun email ne sera envoyé.</p><button type="submit" className="pc-button pc-primary">Confirmer l’envoi <Mail size={15} /></button>
    </form> : <Action disabled={!demo.pdfReady} onClick={() => setComposing(true)}>Préparer l’email <Mail size={15} /></Action>}
    <button className="pc-text-button" onClick={() => demo.setSurface("exports")}>Exports internes <ArrowRight size={13} /></button>
  </div>;
}

function PurchaseWorkspace({ demo }: { demo: Demo }) {
  const [checked, setChecked] = useState(false);
  const [site, setSite] = useState("Résidence des Tilleuls");
  return <div className="pc-workspace-content"><p>Devis accepté · {demo.ordersCreated ? "Trois lignes transférées" : "Trois lignes préparables"}</p>
    {supplierGroups.map((group, index) => <div className="pc-supplier" key={group.name}><PackageCheck size={20} /><div><h3>{group.name}</h3><p>{group.lines} ligne{group.lines > 1 ? "s" : ""} · {formatEUR(group.cents)} HT</p></div>{demo.ordersCreated ? <Tag success>BC-026-{index + 1} · Brouillon</Tag> : <Tag>À préparer</Tag>}</div>)}
    {demo.ordersCreated ? <div className="pc-confirmation"><Check size={19} /><div><strong>Deux brouillons créés</strong><p>La préparation est conservée dans cette maquette. Aucun envoi fournisseur effectué.</p></div></div> : <>
      <label className="pc-field">Chantier de livraison<input value={site} onChange={(event) => setSite(event.target.value)} /></label>
      <label className="pc-check"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />J’ai vérifié les lignes, les montants et la livraison.</label>
      <Action disabled={!checked || !site.trim()} onClick={() => demo.setOrdersCreated(true)}>Créer les deux brouillons <ArrowRight size={14} /></Action>
    </>}
  </div>;
}

export function SurfaceContent({ surface, demo, advance }: { surface: Surface; demo: Demo; advance: (scenario: Scenario) => void }) {
  if (surface === "documents") return <DocumentWorkspace demo={demo} />;
  if (surface === "devis") return <EstimateWorkspace demo={demo} advance={advance} />;
  if (surface === "remise") return demo.scenario === "remise" || demo.scenario === "achats" ? <OutputWorkspace demo={demo} /> : null;
  if (surface === "achats") return demo.scenario === "achats" ? <PurchaseWorkspace demo={demo} /> : null;
  if (surface === "activite") return <Activity />;
  if (surface === "brief") return <div className="pc-workspace-content"><span className="pc-eyebrow">PÉRIMÈTRE DE L’ÉTUDE</span><h3>Installation de plomberie sanitaire</h3><p>Réseaux eau froide et évacuation, équipements sanitaires et pose. Étude à partir des plans et des pièces techniques disponibles.</p><div className="pc-note">La structure du devis pourra être saisie manuellement ou issue d’un DPGF, selon le dossier.</div>
    {demo.scenario === "dossier" ? <><Action disabled={demo.pending > 0 || !demo.issueResolved} onClick={() => { demo.setBriefConfirmed(true); demo.setSurface(null); advance("etude"); }}>Confirmer le brief et démarrer l’étude</Action>
      {demo.pending > 0 || !demo.issueResolved ? <p className="pc-muted">Vérifiez les pièces et arbitrez le manque critique avant de confirmer ce scénario.</p> : null}</> : <Tag success>Brief confirmé</Tag>}</div>;
  if (surface === "registre") return <div className="pc-workspace-content"><Tag>Point à arbitrer</Tag><h3>Annexe technique du CCTP non reçue</h3><p>Cette annexe est annoncée dans le dossier. Elle doit préciser le périmètre des équipements.</p>{demo.issueResolved ? <div className="pc-confirmation"><Check size={18} />Point arbitré · périmètre confirmé.</div> : <Action onClick={() => demo.setIssueResolved(true)}>Confirmer que l’annexe est hors périmètre <Check size={14} /></Action>}</div>;
  return <div className="pc-workspace-content"><h3>Export interne du chiffrage</h3><p>Dans l’application, l’export BDC / Excel conserve les quantités, prix, fourniture et main-d’œuvre.</p><Action quiet onClick={() => {
    const csv = "\uFEFFDésignation;Quantité;Unité;Prix unitaire HT EUR\n" + lines.map((line) => `${line.label};${line.quantity};${line.unit};${(line.price / 100).toFixed(2)}`).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "exemple-chiffrage-tilleuls.csv"; anchor.click(); URL.revokeObjectURL(url);
  }}>Télécharger l’exemple CSV</Action></div>;
}

const titles: Record<Surface, string> = { documents: "Documents du dossier", brief: "Brief de l’affaire", registre: "Point du registre", devis: "Chiffrage du devis", remise: "Remise du devis", achats: "Préparation des achats", activite: "Activité récente", exports: "Exports internes" };
export function SurfaceDialog({ demo, advance }: { demo: Demo; advance: (scenario: Scenario) => void }) {
  return <Dialog open={demo.surface !== null} onOpenChange={(open) => { if (!open) demo.setSurface(null); }}><DialogContent size={demo.surface === "documents" ? "full" : "xl"} className="pc-dialog">
    <DialogHeader><DialogTitle>{demo.surface ? titles[demo.surface] : "Détail"}</DialogTitle><DialogDescription>Maquette interactive · données fictives · actions simulées</DialogDescription></DialogHeader>
    {demo.surface ? <SurfaceContent key={demo.surface} surface={demo.surface} demo={demo} advance={advance} /> : null}
  </DialogContent></Dialog>;
}
