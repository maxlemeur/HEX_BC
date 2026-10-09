# Notifications Base UI, cascade CSS et comparaison fournisseurs

## Échecs observables et scénarios avant implémentation

- Notifications perdues lors d'une rafale, plus de trois notifications visibles, notification en attente expirée avant affichage : créer cinq notifications, retirer une notification en attente, fermer une notification visible puis vérifier la promotion et sa durée entière.
- Notification impossible à fermer au clavier, masquée par une modale ou illisible : fermeture clavier, pause au survol/focus, notification pendant une modale et axe sur le viewport réel.
- Seuil fournisseur perdu ou remplacé par une constante : ouvrir la comparaison depuis le vrai tableau, servir des réponses HTTP avec seuils 45 et 120 jours, puis sans seuil. Vérifier le seuil affiché et l'avertissement de prix ancien ; aucune valeur inventée pour une réponse historique.
- Couche legacy plus forte que les utilitaires, ou tableau gelé écrasé : compiler le vrai globals.css, vérifier un bouton qui combine classe historique et utilitaire, puis les dimensions et styles du tableau réel.
- Contraste FO/MO insuffisant : axe `color-contrast` sur les deux vrais super-en-têtes, aux largeurs 1600 et 1280 px.

Commande : `npx playwright test --config=e2e/ui-polish.local.config.ts`.
Rapport : `.e2e/ui-polish/report/` ; résultats, captures et manifestes : `.e2e/ui-polish/results/`.
La fixture utilise les composants réels, des identités synthétiques et un serveur HTTP loopback. Elle ne prouve pas une lecture connectée de Supabase ni l'autorisation serveur. Aucun changement SQL n'est requis : `getEstimateSupplierComparisons` et OpenAPI exposent déjà `stale_price_days` ; le raccordement manquant est dans le tableau.

Les anciens tests de Toast, dépendants du DOM et des timers de l'implémentation remplacée, sont remplacés par ces scénarios navigateur. Aucun nouveau test isolé.

## Réalisation et périmètre

Le moteur [Base UI Toast](https://base-ui.com/react/components/toast) est chargé à la première notification. L'adaptateur conserve l'API `useToast`, les trois notifications visibles et l'ordre FIFO. Les erreurs et avertissements conservent leur priorité haute ; les timers se suspendent au survol/focus et démarrent seulement lors de l'affichage. La promotion attend la fin de la suppression dans le store Base UI pour éviter de retirer une autre notification.

`legacy.css` est dans la couche `legacy`, déclarée entre `base` et `components`/`utilities` dans `globals.css`, conformément à la [cascade Tailwind](https://tailwindcss.com/docs/preflight). Le tableau gelé reste hors couche. Les couleurs FO/MO utilisent les tokens `info` et `warning`, sans changer les fonds ni les dimensions.

Le contrat API précise que `stale_price_days` est le seuil du tenant, entier de 1 à 3650 jours. Le tableau transmet la valeur à la comparaison. Une réponse ancienne sans valeur conserve un avertissement générique. OpenAPI est régénéré ; aucune migration ni modification de la logique serveur.

Sur ce poste Windows, les tests nécessitent le cache navigateur existant :
`$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/thann/AppData/Local/ms-playwright'; npx playwright test --config=e2e/ui-polish.local.config.ts`.
Le sandbox bloque le réseau loopback de Chromium et certaines écritures de caches ; les validations exécutées hors sandbox restent locales.

## Validation du 9 octobre 2026

- Navigateur local : quatre scénarios réussis, zéro échec/saut ; captures et réponses de comparaison conservées. Chaque dossier de résultat contient `manifest.json` (commande, revision, diff, identités et SHA-256 des sources) et `actual.json` (résultat et stabilité des sources).
- Contraste FO/MO : axe passe à 1600 et 1280 px ; avant correction, les ratios mesurés étaient 2,45:1 et 2,90:1.
- Suite Vitest retenue : 431 fichiers réussis, un ignoré ; 2692 tests réussis et deux ignorés. Les tests ignorés ne constituent pas une preuve.
- Lint ciblé, typecheck, validation OpenAPI et `git diff --check` réussis.
- Build et budgets réussis ; tableau : 495573 / 500000 octets gzip. La mise à jour concurrente de Next.js 16.3.0 vers 16.4.0 dans les fichiers de dépendances est conservée, et le build utilise 16.4.0.

Les preuves portent sur la fixture loopback et le build local, sans recette connectée de Supabase. Aucun commit, push ou déploiement.
