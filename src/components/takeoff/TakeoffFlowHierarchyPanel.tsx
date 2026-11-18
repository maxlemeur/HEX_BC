import { JourneyHelp } from "@/components/journey/JourneyPage";

export function TakeoffFlowHierarchyPanel() {
  return (
    <JourneyHelp summary="Comment s’organise un métré ?">
      <dl>
        <dt>Préparer le métré</dt>
        <dd>Ajoutez les plans de l’affaire et confirmez la préparation pour lancer l’analyse.</dd>
        <dt>Suivi et reprise · page actuelle</dt>
        <dd>Suivez les analyses, vérifiez les quantités puis confirmez leur envoi au tableau de chiffrage.</dd>
      </dl>
    </JourneyHelp>
  );
}
