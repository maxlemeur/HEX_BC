# Automatisation prix Sofinther

Cette automatisation se connecte a `https://www.sofinther.fr/sof/`, recherche des references et produit un CSV importable dans le pricebook fournisseur.

## Identifiants

Les identifiants sont lus depuis `docs/sofinther-credentials.local.md`.

Ce fichier est volontairement ignore par Git. Ne pas le renommer en `.md` versionne et ne pas copier le mot de passe dans une documentation commitee.

Format attendu :

```md
SOFINTHER_EMAIL=maxime.michel@hydroexpress.fr
SOFINTHER_PASSWORD=...
```

## Lancement

Recherche directe :

```bash
npm run prices:sofinther -- --refs "REF001,REF002" --output tmp/sofinther-prices.csv
```

Depuis un fichier texte ou CSV, une reference par ligne :

```bash
npm run prices:sofinther -- --input tmp/sofinther-refs.txt --output tmp/sofinther-prices.csv
```

Mode visible pour regler le parcours si le site change :

```bash
npm run prices:sofinther -- --refs "REF001" --headed
```

## Sortie CSV

Colonnes produites :

- `supplier_name`
- `product_reference`
- `product_designation`
- `unit_price`
- `currency`
- `source_url`
- `scraped_at`
- `status`
- `notes`

Les cinq premieres colonnes correspondent au mapping attendu par l'import pricebook existant.

## Points a verifier apres le premier run

- Si le site affiche une double authentification ou un captcha, lancer en `--headed` et terminer la connexion manuellement.
- Si un prix est detecte mais pas le bon, conserver le CSV en sortie et ajuster les heuristiques dans `scripts/sofinther-prices.ts`.
- Si les produits n'existent pas encore dans le catalogue local, les lignes seront a resoudre dans l'import pricebook.
