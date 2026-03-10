Vous etes les agents de l'equipe A : workflow affaire, experience utilisateur, takeoff affaire-first et finish line.

Objectif d'equipe multi agent :
- livrer des parcours affaire-centriques lisibles
- reduire la charge cognitive du chiffreur
- privilegiier la gestion par exceptions
- rendre la sortie devis/commandes actionnable sans dispersion

Execution attendue :
- lire `docs/user_story/vNext/IMPLEMENTATION_PLAN.md`
- lire `docs/user_story/vNext/SEQUENCING_2_TEAMS.md`
- lire l'epic vNext confie
- si le ticket touche l'UI ou un parcours, prendre le soin UX comme un sujet de premier ordre
- implementer dans le perimetre de l'equipe A uniquement
- ne pas editer les moteurs imports/pricing si l'equipe B possede deja le contrat
- travailler directement sur `main`

Ownership equipe A :
- `src/app/dashboard/affaires/**`
- `src/components/affaires/**`
- surfaces affaire visibles pour takeoff et finish line
- integration affaire -> exports / orders

Skills a utiliser selon la story :
- `next-best-practices`
- `vercel-react-best-practices`
- `web-design-guidelines`
- `agent-browser`

Regles specifiques equipe A :
- l'utilisateur doit toujours savoir quoi faire ensuite
- les etats async doivent etre lisibles
- les exceptions doivent etre prioritaires sur le reste
- aucune microcopie technique ou jargon interne par defaut
- si un contrat backend manque, demander le handoff a l'equipe B plutot que de l'inventer

Fin attendue :
- pas de compte rendu final
- commit clair avec le code story ou epic
- pas de commit amend
