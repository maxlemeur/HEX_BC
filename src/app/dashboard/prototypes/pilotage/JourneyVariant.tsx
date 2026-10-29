import { useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

import { scenarios, useDemo, type Scenario } from "./model";
import { Activity, Facts, Heading, Issue, PrimaryAction, SurfaceDialog, Tag } from "./shared";

const stageDescriptions = ["Documents, périmètre et brief", "Structure, métrés et prix", "Validation, PDF et email client", "Brouillons de commandes fournisseurs"];

export function JourneyVariant({ scenario, advance }: { scenario: Scenario; advance: (scenario: Scenario) => void }) {
  const demo = useDemo(scenario);
  const current = scenarios.findIndex((item) => item.id === scenario);
  const [expanded, setExpanded] = useState(current);
  return <div className="pc-variant pc-journey">
    <Heading demo={demo} />
    <div className="pc-journey-grid"><section className="pc-panel pc-journey-panel" aria-label="Parcours de l’affaire">
      <div className="pc-panel-title"><h2>Le parcours de l’affaire</h2><span>Étape {current + 1} sur {scenario === "achats" ? 4 : 3}</span></div>
      {scenarios.filter((stage) => stage.id !== "achats" || scenario === "achats").map((stage, index) => <div key={stage.id} className={`pc-journey-step ${index === current ? "pc-journey-current" : ""}`}>
        <button className="pc-step-heading" disabled={index > current} aria-expanded={expanded === index} onClick={() => setExpanded(expanded === index ? -1 : index)}>
          <span className={`pc-step-number ${index < current ? "pc-number-done" : ""}`}>{index < current ? <Check size={16} /> : index + 1}</span>
          <span><strong>{stage.stage}</strong><small>{stageDescriptions[index]}</small></span>
          {index === current ? <Tag>En cours</Tag> : index < current ? <Tag success>Terminé</Tag> : <span className="pc-muted">À venir</span>}
          {index <= current ? <ChevronDown size={16} /> : null}
        </button>
        {expanded === index && index === current ? <div className="pc-step-body"><PrimaryAction demo={demo} compact /><Issue demo={demo} /></div> : null}
        {expanded === index && index < current ? <div className="pc-completed-stage"><Check size={17} /><p>{index === 0 ? "Le dossier et le brief ont été relus et confirmés." : index === 1 ? "Les quantités et les prix de la version 1 ont été vérifiés." : "Le devis a été envoyé, puis accepté par le client."}</p><button className="pc-text-button" onClick={() => demo.setSurface(index === 0 ? "documents" : index === 1 ? "devis" : "remise")}>Consulter <ChevronRight size={13} /></button></div> : null}
      </div>)}
    </section><aside className="pc-journey-aside"><section className="pc-panel"><Facts demo={demo} /></section><details className="pc-history"><summary>Activité récente</summary><Activity /></details></aside></div>
    <SurfaceDialog demo={demo} advance={advance} />
  </div>;
}
