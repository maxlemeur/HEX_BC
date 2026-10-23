# Documentation de MergeOne

Ce répertoire contient les références nécessaires pour travailler sur le code
courant. Les versions et commandes viennent de [package.json](../package.json),
les données de [l'historique des migrations](../supabase/migrations/).
Le [README](../README.md) suffit pour commencer ; [AGENTS.md](../AGENTS.md)
définit le contrat de contribution.

## Références

| Sujet | Document |
|---|---|
| Parcours du produit, vocabulaire et repères dans le code | [Domaines](domaines/README.md) |
| Calculs, moteurs historiques et moteur 3 | [Règles de calcul](metier/regles-de-calcul.md) |
| Statuts, approbation, émission et immutabilité | [Cycle de vie](metier/cycle-de-vie.md) |
| Authentification, tenants, RLS et accès privilégiés | [Sécurité](domaines/securite-multi-tenant.md) |
| Lancer les tests et choisir une recette | [Guide de tests](../e2e/README.md) |
| Migrations, types, sauvegarde et reprise des tâches | [Exploitation](../supabase/README.md) |
| Importer les prix Sofinther | [Automatisation fournisseur](sofinther-automation.md) |

Les guides spécialisés CI, développement local, moteur 3 et performance sont
référencés depuis le guide de tests. La documentation d'API est générée dans
[openapi.json](../openapi.json), sans copie manuelle des endpoints.

## Documents conservés pour un usage précis

- Les fichiers `testing/shared-supabase-*` servent au garde de migrations
  [`supabase-migration-restamp.ts`](../src/test/supabase-migration-restamp.ts).
  Ils attestent des applications passées, sans certifier l'état distant actuel.
- Certaines recettes de `testing/` sont lues ou empreintées par les runners ;
  leur rôle est décrit dans [le guide de tests](../e2e/README.md).
- [Les dispositions du scan de sécurité](security-remediation-91386191.md)
  gardent l'identité des constats et les limites de leur qualification historique.
- [L'inventaire d'audit](audit/AUDIT-2026-07-inventaire.md) est généré depuis
  [sa source JSON](audit/AUDIT-2026-07-source.normalized.json). Le test de
  [régénération](../src/lib/audit-artifact-generator.test.ts) compare leurs octets.
  Son état « au HEAD » désigne le snapshot historique, pas le checkout courant.
- [Les décisions du moteur 3](audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md)
  et ses données d'oracle gardent la provenance des contrôles de calcul.
- [La notice du corpus privé](prd_file/README.md) et
  [les fixtures fictives](../e2e/fixtures/business/README.md) distinguent les
  originaux métier des entrées publiables. Les originaux et leurs copies ne sont
  pas de la documentation à supprimer.

## Historique et entretien

Les anciens audits, plans, rétrospectives et reçus intermédiaires retirés de
l'arbre courant restent dans Git. Pour retrouver un document antérieur au
nettoyage du 23 octobre 2026 :

```bash
git show 9ee18ca8187d1e4f76e8b196be90d85e2fa1334b:docs/chemin-du-document.md
```

Une référence datée, y compris dans un commentaire de code ou une migration,
se lit à la révision qu'elle décrit ; elle ne constitue pas une preuve actuelle.
Les rapports locaux et reçus de vérification vont dans `outputs/`, ignoré par Git.
Les résultats historiques ne deviennent pas des tests rejoués par cette mise à jour.

Garder une seule référence par sujet, citer les fichiers et symboles utiles,
et mettre à jour le guide concerné avec le code. Utiliser Git ou le tracker
pour les plans achevés et l'avancement ; ne pas ajouter un rapport Markdown
par correctif. Ne jamais publier secrets, sessions ou données métier privées.
