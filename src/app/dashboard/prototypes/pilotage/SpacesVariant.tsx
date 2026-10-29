import { useState } from "react";
import { ArrowRight, ClipboardList, FileText, FolderOpen, LayoutDashboard, Mail, PackageCheck } from "lucide-react";

import { useDemo, type Scenario, type Surface } from "./model";
import { Activity, Facts, Heading, Issue, PrimaryAction, SurfaceContent, SurfaceDialog } from "./shared";

const workspaceNames = { documents: "Documents", brief: "Brief", devis: "Devis et métrés", remise: "Remise du devis", achats: "Achats" };
type Workspace = keyof typeof workspaceNames;

export function SpacesVariant({ scenario, advance }: { scenario: Scenario; advance: (scenario: Scenario) => void }) {
  const demo = useDemo(scenario);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [activity, setActivity] = useState(false);
  const entries = [
    { id: "documents" as const, label: "Documents", Icon: FolderOpen },
    { id: "brief" as const, label: "Brief", Icon: FileText },
    ...(scenario !== "dossier" ? [{ id: "devis" as const, label: "Devis et métrés", Icon: ClipboardList }] : []),
    ...(scenario === "remise" || scenario === "achats" ? [{ id: "remise" as const, label: "Remise du devis", Icon: Mail }] : []),
    ...(scenario === "achats" ? [{ id: "achats" as const, label: "Achats", Icon: PackageCheck }] : []),
  ];
  function openWorkspace(id: Surface) {
    if (id in workspaceNames) setWorkspace(id as Workspace);
    else demo.setSurface(id);
  }
  return <div className="pc-variant pc-spaces">
    <Heading demo={demo} />
    <div className="pc-spaces-grid"><nav className="pc-space-nav" aria-label="Espaces de l’affaire"><span className="pc-eyebrow">L’AFFAIRE</span>
      <button aria-current={workspace === null ? "page" : undefined} onClick={() => setWorkspace(null)}><LayoutDashboard size={17} />Pilotage</button>
      <div className="pc-nav-divider" />
      {entries.map(({ id, label, Icon }) => <button key={id} aria-current={workspace === id ? "page" : undefined} onClick={() => setWorkspace(id)}><Icon size={17} />{label}{id === "documents" && demo.pending > 0 ? <span>{demo.pending}</span> : null}</button>)}
      <div className="pc-nav-bottom"><strong>Une activité par espace</strong><p>Retrouvez vos pièces et vos outils sans quitter l’affaire.</p></div>
    </nav>
    <section className="pc-panel pc-space-main" aria-label={workspace ? workspaceNames[workspace] : "Pilotage par espaces"}>
      {workspace ? <><div className="pc-panel-title"><h2>{workspaceNames[workspace]}</h2><button className="pc-text-button" onClick={() => setWorkspace(null)}>Retour au pilotage</button></div><SurfaceContent key={workspace} surface={workspace} demo={demo} advance={advance} /></> : <>
        <div className="pc-space-top"><div><span className="pc-eyebrow">VUE D’ENSEMBLE</span><h2>Pilotage de l’affaire</h2></div><div className="pc-view-switch"><button aria-pressed={!activity} onClick={() => setActivity(false)}>À faire</button><button aria-pressed={activity} onClick={() => setActivity(true)}>Activité</button></div></div>
        {activity ? <Activity /> : <div className="pc-space-overview"><div className="pc-space-focus"><PrimaryAction demo={demo} onOpen={openWorkspace} /><Issue demo={demo} /><button className="pc-text-button" onClick={() => setWorkspace("brief")}>Relire le périmètre de l’étude <ArrowRight size={13} /></button></div><Facts demo={demo} /></div>}
      </>}
    </section></div>
    <SurfaceDialog demo={demo} advance={advance} />
  </div>;
}
