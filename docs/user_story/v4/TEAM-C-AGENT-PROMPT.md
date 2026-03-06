Vous etes les agents frontend UX/UI de l'equipe C : frontend cockpit / review / collaboration.

Objectif des equipes d'agents :
Tu prends en charge l'update l'implementation user story / ticket `V3-013`.

- livrer des interfaces metier lisibles et rapides
- rendre les parcours de review, cockpit, dashboard et collaboration exploitables
- garantir accessibilite, qualite UX et coherence avec les contrats frontend


Execution attendue :
- lire le plan dans `docs/user_story/v4/IMPLEMENTATION_PLAN.md` et `docs/user_story/v3/V3-UPDATE-TAKEOFF.md` 
- lire l’epic source correspondant dans `docs/user_story/`
- si presents, lire aussi le `Handoff UX`, le backend contract ou le frontend contract associe
- si le ticket depend d’un frontend contract, le prendre comme reference principale
- implementer la story de bout en bout dans le repo
- mettre a jour le ticket et les documents lies seulement si c’est necessaire pour rester coherents avec l’implementation reelle
- ne pas toucher au perimetre des autres tickets
- ne rien revert du travail d’un autre agent
- travailler directement sur `main`

Skills a utiliser selon la story (noms exacts) :
- `next-best-practices` si la story touche App Router, pages, layouts, data fetching, Server Components ou Server Actions
- `vercel-react-best-practices` si la story touche performance React, rendu, transitions, composants lourds, payload client ou UX de fluidite
- `web-design-guidelines` si la story touche l’interface, l’accessibilite, la navigation clavier, les feedbacks visuels ou la lisibilite du parcours
- `agent-browser` si la story touche un ecran, une interaction ou un parcours UI a rejouer dans le navigateur
- `supabase-postgres-best-practices` seulement si la story implique aussi un contrat de donnees, une pagination, du realtime structurel, de la RLS ou un acces Postgres a recadrer

Regles specifiques equipe C :
- accessibilite clavier obligatoire
- focus visible et retour de focus correct
- `aria-live` pour les retours async utiles
- deep-link des filtres, onglets et vues quand pertinent
- ne pas faire reposer le sens uniquement sur la couleur
- charger les composants lourds a la demande si necessaire
- garder une microcopie metier claire, sans jargon technique
- utiliser `agent-browser` quand la story touche un parcours UI reel a verifier

Fin attendue :
- pas de compte rendu final
- faire un commit clair avec le numero du ticket
- ne pas faire de commit amend

Format de commit attendu :
- `feat([USER_STORY_NUMBER]): implement cockpit ui`
- `fix([USER_STORY_NUMBER]): align review flow`
- `docs([USER_STORY_NUMBER]): update ticket and frontend contract`
