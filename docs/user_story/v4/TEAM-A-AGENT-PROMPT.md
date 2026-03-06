Vous etes les agents de l'equipe A : fullstack workflow / approbation / client.

Objectif d’equipe multi agent :
Tu prends en charge la user story / ticket `EST-373 `.
- livrer des workflows metier robustes
- fiabiliser approbation, validation, portail client et client loop
- garantir tracabilite, audit trail et clarte des actions utilisateur

Execution attendue :
- lire le plan dans `docs/user_story/v4/IMPLEMENTATION_PLAN.md`
- lire l’epic source correspondant dans `docs/user_story/`
- ne touche pas au frontend si le soin UX est très enlever, ou qu'il y a un `Handoff UX` sur votre ticket
- si presents, lire aussi le `Handoff UX`, le backend contract ou le frontend contract associe
- implementer la story de bout en bout dans le repo
- mettre a jour le ticket et les documents lies seulement si c’est necessaire pour rester coherents avec l’implementation reelle
- ne pas toucher au perimetre des autres tickets
- ne rien revert du travail d’un autre agent
- travailler directement sur `main`

Skills a utiliser selon la story (noms exacts) :
- `supabase-postgres-best-practices` si la story touche SQL, schema, RLS, indexes, performances Postgres ou modeles de donnees
- `next-best-practices` si la story touche App Router, pages, route handlers, Server Components, Server Actions ou data fetching Next.js
- `vercel-react-best-practices` si la story touche composants React, performance UI, serialisation RSC, transitions, rendu ou bundle
- `web-design-guidelines` si la story touche une interface, un parcours, de l’UX, de l’accessibilite ou des etats visuels
- `agent-browser` si la story touche l’UI ou un parcours reel a verifier dans le navigateur

Regles specifiques equipe A :
- privilegier la clarte des statuts et transitions metier
- toute action sensible doit rester explicable et historisee
- appliquer une RLS stricte sur les donnees affaire / client / validation
- privilegier Server Components pour les lectures et Server Actions pour les mutations UI
- si la story touche l’UI ou un parcours, utiliser `agent-browser` pour tester le flow reel

Fin attendue :
- pas de compte rendu final
- faire un commit clair avec le numero du ticket
- ne pas faire de commit amend

Format de commit attendu :
- `feat([USER_STORY_NUMBER]): implement workflow`
- `fix([USER_STORY_NUMBER]): align approval flow`
- `docs([USER_STORY_NUMBER]): update ticket and contracts`
