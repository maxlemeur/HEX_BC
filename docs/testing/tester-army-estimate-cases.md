# Tester Army : intégrité des devis

## Défaillances définies avant les tests

Ces scénarios emploient la session `army`, le Supabase autorisé et uniquement de nouveaux projets dont le nom commence par `ARMY`. Chaque version créée ou dupliquée est inscrite dans l'inventaire de la campagne. Les données restent disponibles pour rejouer les constats. Aucun scénario n'envoie de courriel.

| Scénario | Défaillances recherchées | Preuve attendue |
| --- | --- | --- |
| Création, saisie, autosave, rechargement | Mauvais moteur ou paramètres hérités ; dernière saisie perdue ; état « sauvegardé » sans persistance ; prix français mal interprété ; TVA calculée sur l'agrégat plutôt que par ligne ; pied différent des lignes | Lecture API des lignes et du pied, valeurs des contrôles après rechargement, oracle en centimes et inventaire des nouvelles versions |
| Duplication indépendante | Ligne ou parent absent ; identité de ligne réutilisée ; calcul ou paramètres perdus ; fichier/page de provenance perdu ; édition du duplicata modifiant la source ; rechargement affichant les anciens montants | Signatures de hiérarchie avant/après, identités distinctes, marqueurs de provenance manuelle non vides, deux lectures API après l'édition et rechargement des contrôles source/copie |
| XLSX, DPGF et impression | Classeur vide mais HTTP 200 ; colonnes ou données incorrectes ; pied d'export différent du devis ; DPGF perdant quantité/prix ; impression manquant des lignes ou annonçant un autre montant | Fichiers téléchargés conservés avec SHA-256, cellules réellement relues et contenu visible de la page d'impression |

## Fixture et oracle indépendant

Le wizard crée un devis EUR, moteur 2, brouillon, marge fixe de multiplicateur 1, TVA 20 %, remise nulle, coefficient global 1, régime `principal` et sans arrondi commercial. Les lignes sont `supply_only`, avec K FO = 1, heures MO = 0 et aucun prix fournisseur sélectionné. Une section contient trois lignes :

| Ligne | Quantité | Prix d'achat unitaire HT | HT en centimes | TVA en centimes | TTC en centimes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Principale | 2 | 100,00 EUR | 20000 | 4000 | 24000 |
| Centime B | 1 | 0,02 EUR | 2 | 0 | 2 |
| Centime C | 1 | 0,02 EUR | 2 | 0 | 2 |
| Pied | | | **20004** | **4000** | **24004** |

La TVA provient de la somme des taxes arrondies par ligne. Calculer 20 % de 20004 centimes produirait 4001 centimes et doit échouer. L'oracle est une constante documentée, indépendante du moteur de calcul applicatif.

La ligne principale reçoit une première saisie puis la valeur finale avant vérification. Après rechargement, le test relit les contrôles et les données persistées ; un badge « Sauvegardé » seul ne suffit pas. Sur le duplicata, passer la quantité principale à 3 donne **30004 / 6000 / 36004** centimes ; la source conserve **20004 / 4000 / 24004**.

Pour le rejeu après migration, les trois lignes de duplication portent `source_provider: manual`, une référence de fichier propre à la fixture et des pages distinctes `1/2/3`, transmises par la vraie API des lignes. Ces marqueurs doivent déjà être présents dans la source sauvegardée, puis rester exacts sur la copie avant et après édition/rechargement. Ce sont des références synthétiques de fixture manuelle, sans extraction PDF ni import natif. L'API de création ne prend pas de `source_metadata` JSON arbitraire : la copie de métadonnées JSON non vides reste qualifiée séparément par la régression PostgreSQL isolée.

La cadence automatique actuelle est de 60 secondes (`AUTOSAVE_DEBOUNCE_MS`) : l'attente de preuve API est bornée à 90 secondes et vérifie simultanément les saisies, les montants des lignes et le pied. Seul le scénario « Création, saisie, autosave, rechargement » attend ce cycle automatique, sans Ctrl+S : c'est lui qui qualifie l'autosave. Depuis le 17/10/2026, la duplication (source puis duplicata), les exports, l'association d'article et les deux parcours de `numeric-entry.e2e.ts` déclenchent la sauvegarde par Ctrl+S (`saveLineEditsWithShortcut`, `fixtures.ts`) une fois que la barre d'outils affiche « En attente » ou « Synchronisation… », puis prouvent la persistance par la même attente API ; la preuve métier `save-shortcut-<versionId>` enregistre le déclenchement. Si le raccourci restait sans effet, l'autosave à 60 s ferait encore aboutir l'attente dans ses 90 secondes : plus lent, jamais plus faible. Le budget de 240 secondes du duplicata est inchangé.

## Interfaces réelles

- Wizard : `/dashboard/estimates/new`, labels `Nom du projet`, `Titre de la version`, `Marge (%)`, `TVA (%)`, boutons `Suivant` puis `Créer le chiffrage`.
- Éditeur : `/dashboard/estimates/<versionId>/edit`, grille `Lignes de devis`, labels `Quantité pour <titre>` et `Prix d’achat unitaire HT pour <titre>`.
- Lecture : `GET /api/estimates/<versionId>` ; duplication : `POST /api/estimates/<versionId>/duplicate`.
- Écriture de fixture : API réelle des lignes, avec contrôle `If-Match` et session de verrou `x-estimate-draft-lock-session-id`, gérés par les fixtures communes.
- Export standard : menu `Exporter`, bouton `Excel (.xlsx)` ; DPGF : `estimate-page-toolbar-more-actions-button`, puis `estimate-page-toolbar-export-dpgf-button`.
- Impression : `/dashboard/estimates/<versionId>/print?price_mode=unit_and_total&detail_level=lines`, titre `Devis`, bouton `Mise en page / imprimer`, lignes et totaux visibles.

## Frontières de la preuve

Le Playwright historique vérifie surtout la navigation, le titre d'une ligne dupliquée, une taille de téléchargement non nulle et le nom du projet imprimé. Son helper de saisie emploie encore les anciens labels `Quantite` et `Prix unitaire`. Ces assertions et sélecteurs ne sont pas réutilisés pour qualifier l'intégrité financière.

Le pilote Army anonyme reste séparé : ses routes et consignes interdisent authentification et requêtes d'écriture. Les scénarios critiques nécessitent la fixture de session authentifiée autorisée. Les mots de passe et cookies ne sont jamais ajoutés aux JSON de preuve ; les scénarios ne demandent aucune capture SDK après la saisie du secret. Les traces authentifiées sont désactivées : le SDK n'expurge pas tous les JWT Supabase. Seul le pilote anonyme conserve des traces.

Chaque exécution critique doit produire le manifeste du runner, son rapport frais, les identifiants des nouvelles ressources et les JSON des oracles/lectures. Le manifeste référence commande, révision, empreinte du diff, environnement et empreintes des entrées. Les fichiers XLSX/DPGF sont conservés par le mécanisme de téléchargement du SDK ; leur signature ZIP, leur format relu par ExcelJS et leurs cellules sont vérifiés, et leurs chemins/SHA-256 figurent dans la preuve métier. Le contenu d'impression est extrait du DOM en texte limité aux lignes et montants du devis créé.

Ces trois scénarios ne qualifient pas les arrondis commerciaux, les barèmes du tenant, la main-d'œuvre, l'autoliquidation, les conflits multi-onglets ni l'envoi/finalisation. Ils ne doivent pas justifier la suppression de leurs régressions spécialisées. Le code actuel conserve des contrats historiques v1 et des arrondis distincts selon la surface ; une campagne ultérieure doit définir son oracle métier avant de les exercer.
