# Prix Sofinther

[`scripts/sofinther-prices.ts`](../scripts/sofinther-prices.ts) recherche des
références sur le site Sofinther et produit un CSV pour l'import pricebook.
Il utilise Playwright ; une session navigateur et un compte fournisseur autorisé
sont nécessaires. Le script n'est pas une garantie de compatibilité avec le site
courant : vérifier les prix et statuts du CSV avant import.

## Configuration et exécution

Après `npm ci`, installer le navigateur de la version Playwright du script :
`npx playwright install chromium`. Le navigateur installé pour TesterArmy
peut appartenir à une autre version.

Fournir `SOFINTHER_EMAIL` et `SOFINTHER_PASSWORD` par l'environnement, ou dans
`docs/sofinther-credentials.local.md` (ignoré par Git), au format `NOM=valeur`.
`--credentials <chemin>` choisit un autre fichier local. Ne jamais publier ces
identifiants ni les sorties contenant des tarifs privés.

```bash
npm run prices:sofinther -- --refs "REF001,REF002" --output outputs/sofinther/prices.csv
npm run prices:sofinther -- --input outputs/sofinther/refs.txt --output outputs/sofinther/prices.csv
```

Le fichier d'entrée contient uniquement des références séparées par des retours
à la ligne, virgules, points-virgules ou tabulations : le script découpe tous les
champs, il ne sélectionne pas une colonne d'un CSV métier. `--headed` ouvre le
navigateur pour diagnostiquer le parcours. `--timeout-ms` règle le délai des actions.
Sans `--output`, le script utilise encore `tmp/sofinther-prices.csv` ; préférer
explicitement `outputs/` pour les résultats du projet.

## Sortie

Colonnes : `supplier_name`, `product_reference`, `product_designation`,
`unit_price`, `currency`, `source_url`, `scraped_at`, `status`, `notes`.
Les statuts sont `ok`, `not_found`, `error`. Relire les lignes en erreur, les
références, unités et prix avant de mapper les cinq premières colonnes dans
l'import fournisseur. Les heuristiques de lecture se trouvent dans le script.
