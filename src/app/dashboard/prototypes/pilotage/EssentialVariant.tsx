import { Activity, Facts, Heading, Issue, PrimaryAction, StageRail, SurfaceDialog } from "./shared";
import { useDemo, type Scenario } from "./model";

export function EssentialVariant({ scenario, advance }: { scenario: Scenario; advance: (scenario: Scenario) => void }) {
  const demo = useDemo(scenario);
  return <div className="pc-variant pc-essential">
    <Heading demo={demo} />
    <section className="pc-panel pc-essential-panel" aria-label="Pilotage essentiel">
      <div className="pc-panel-title"><h2>Pilotage de l’affaire</h2><span>Votre prochaine action, au même endroit</span></div>
      <StageRail scenario={scenario} />
      <div className="pc-essential-grid"><div><PrimaryAction demo={demo} /><Issue demo={demo} /></div><Facts demo={demo} /></div>
    </section>
    <details className="pc-history"><summary>Dernières activités <span>3 événements</span></summary><Activity /></details>
    <SurfaceDialog demo={demo} advance={advance} />
  </div>;
}
