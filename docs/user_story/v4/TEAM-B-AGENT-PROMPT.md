Vous etes les agents de l'equipe B : fullstack IA / preuves / prix / risque.

## Objectif d'equipe avec multi agent
Tu prends en charge la user story / ticket `EST-392`.
- livrer des moteurs fiables et explicables
- rendre visibles provenance, confiance, preuves et signaux de risque
- eviter tout automatisme opaque ou toute application silencieuse
- ne touche pas au frontend si le soin UX est très enlever, ou qu'il y a un handoff sur votre ticket


Execution attendue :
- lire obligatoirement le plan dans `docs/user_story/v4/IMPLEMENTATION_PLAN.md` ou se trouve le lien du ticket
- lire l’epic source correspondant dans `docs/user_story/`
- si presents, lire aussi le `Handoff UX`, le backend contract ou le frontend contract associe
- implementer la story de bout en bout dans le repo
- mettre a jour le ticket et les documents lies seulement si c’est necessaire pour rester coherents avec l’implementation reelle
- ne pas toucher au perimetre des autres tickets
- ne rien revert du travail d’un autre agent
- travailler directement sur `main`

Skills a utiliser selon la story (noms exacts) :
- `supabase-postgres-best-practices` si la story touche stockage des preuves, pricing, deltas, RLS, indexes, queues, pagination ou schema
- `next-best-practices` si la story touche App Router, Server Components, Server Actions, route handlers ou patterns de data fetching
- `vercel-react-best-practices` si la story touche rendu React, payload client, performance, `Promise.all`, `startTransition`, `next/dynamic`
- `web-design-guidelines` si la story touche une surface visible de review, pricing, preuves, radar, V0 ou accessibilite
- `agent-browser` ou `Playwright interactive` skills si la story touche l’UI ou un parcours de review / pricing / preuve / V0 a verifier reellement

Regles specifiques equipe B :
- toujours distinguer fait, hypothese et inference
- toujours exposer provenance et niveau de confiance quand pertinent
- indexer les colonnes de filtre / jointure / FK et utiliser des partial indexes si utile
- reduire au maximum le payload client aux frontieres RSC
- utiliser `Promise.all`, `startTransition` et `next/dynamic` quand c’est justifie
- aucune suggestion IA ne doit etre appliquee sans validation humaine explicite
- si la story touche l’UI ou un parcours, utiliser `agent-browser` pour verifier les ecrans de review, preuves, pricing ou V0

Fin attendue :
- pas de compte rendu final
- faire un commit clair avec le numero du ticket
- ne pas faire de commit amend

Format de commit attendu :
- `feat([USER_STORY_NUMBER]): implement evidence and pricing flow`
- `fix([USER_STORY_NUMBER]): align proof contract`
- `docs([USER_STORY_NUMBER]): update ticket and contracts`
