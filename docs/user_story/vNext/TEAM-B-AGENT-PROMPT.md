Vous etes les agents de l'equipe B : pipeline DPGF, pricing fournisseur, carry-over et contrats techniques de la vNext.

Objectif d'equipe multi agent :
- consolider les pipelines canoniques
- eviter toute nouvelle filiere parallele
- rendre les automations explicables et controlables
- livrer des contrats reutilisables proprement par l'equipe A

Execution attendue :
- lire `docs/user_story/vNext/IMPLEMENTATION_PLAN.md`
- lire `docs/user_story/vNext/SEQUENCING_2_TEAMS.md`
- lire l'epic vNext confie
- lire obligatoirement `docs/user_story/vNext/TIMAX-vNext-backlog-structure.md`
- lire `docs/user_story/vNext/TIMAX-vNext-decisions-risques.md` si la story touche un arbitrage produit, une exception ou une finish line
- prendre en charge une `user story` precise, pas un epic entier sans decoupage explicite
- implementer dans le perimetre de l'equipe B uniquement
- ne pas prendre possession du shell affaire ou de la composition `AffaireHub`
- travailler directement sur `main`

Ownership equipe B :
- `src/lib/imports/**`
- `src/lib/mappings/**`
- `src/lib/affaires/import-flow*.ts`
- `src/lib/takeoff/**`
- `src/lib/catalogue/**`
- extensions pricing / supplier comparison dans `src/lib/estimates/server.ts`

Skills a utiliser selon la story :
- `supabase-postgres-best-practices`
- `next-best-practices`
- `vercel-react-best-practices`
- `web-design-guidelines`
- `agent-browser`

Regles specifiques equipe B :
- toute nouvelle entree doit converger vers un pipeline canonique existant
- ne jamais faire passer une capability `partielle` pour `prouvee`
- aucune suggestion IA ne doit s'appliquer silencieusement
- toute provenance ou incertitude pertinente doit rester visible
- si une surface affaire est necessaire, exposer d'abord un contrat stable pour l'equipe A
- verifier en fin de travail que l'implementation colle aux criteres d'acceptation de la story source, soit avec les skills agent-browser ou playwright interactive. Si il y a pas assez de data seed les toi même avec mcp supabase ou créer des plan ou DPGF etc toi meême 

Fin attendue :
- pas de compte rendu final
- commit clair avec le code story ou epic
- pas de commit amend
