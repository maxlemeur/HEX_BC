# Audit polish optionnel avec TesterArmy

## Défaillances définies avant le port

Le retrait de `e2e/polish/screens.spec.ts` ne doit pas supprimer son inventaire de 56 routes ni ses oracles : statut HTTP, exactement un titre principal visible, libellé attendu, débordement horizontal au plus égal à 1 px, absence de violation Axe serious/critical et absence d'écriture bloquée. Les erreurs JavaScript, écritures autorisées et captures restent des observations conservées. Le mode historique `POLISH_ASSERT=1` devient le comportement obligatoire du port.

Le port réutilise directement `e2e/polish/routes.ts`, notamment les quatre dimensions 320, 390, 768 et 1440, et les exclusions Axe existantes. Il reste un profil optionnel séparé de `full` : réussir une sélection ne qualifie ni les routes non sélectionnées ni les fixtures absentes. Une sélection vide/inconnue ou une fixture nécessaire absente échoue ; aucun skip ne vaut un succès.

## Exécution et fixtures

Définir `E2E_ARMY_POLISH_ROUTES` avec les identifiants exacts séparés par des virgules, puis utiliser `npm run e2e:army:polish:list` pour la collecte et `npm run e2e:army:polish` pour l'exécution. Exemple de sélection statique : `login,signup,home,profile`. Le wrapper garde commande, sources, environnement, rapport et artefacts dans son archive critique normale. Chaque route exécute les quatre viewports ; l'authentification ordinaire est requise seulement pour les routes utilisateur. Les routes anonymes partent d'un contexte sans session.

Les routes dynamiques utilisent uniquement les variables historiques exportées : `E2E_UX_PROJECT_ID`, `E2E_UX_VERSION_ID`, `E2E_UX_ORDER_ID`, `E2E_UX_TAKEOFF_PROJECT_ID`, `E2E_UX_TAKEOFF_VERSION_ID`, `E2E_UX_TAKEOFF_JOB_ID`, `E2E_UX_PORTAL_TOKEN`. Aucun fichier d'environnement, cache de fixture ni découverte de données partagées n'est lu. Les identifiants sont vérifiés via le compte normal et ses droits RLS sur le backend local explicitement autorisé : tenant ARMY, projet ARMY du compte, cohérence projet/version/job, devis non brouillon. Une commande doit appartenir au compte et au tenant ARMY. Un jeton portail doit désigner une version autorisée ; il n'est jamais écrit dans la preuve métier. Le wrapper doit expurger `E2E_UX_PORTAL_TOKEN` et ses encodages des journaux SDK avant archivage.

Le garde navigateur conserve les exceptions de lecture historiques (rafraîchissement Auth, RPC, actions serveur et actions de preview/mapping), en les enregistrant sans en-tête ni corps. Les autres écritures sont bloquées et font échouer l'oracle. Le transport reste limité à l'application locale et à son Supabase local autorisé ; la CSS externe Fontshare est satisfaite localement comme dans les autres campagnes Army. Ce garde navigateur ne constitue pas une sandbox des appels serveur.

## Captures et limites

L'API publique Army interdit les captures après saisie d'un secret, y compris dans une session restaurée. Le port ne contourne pas cette règle : les routes authentifiées conservent les oracles et une mention explicite de capture indisponible. Les routes anonymes utilisent `app.screenshot`, qui produit une capture du viewport ; l'API ne propose pas la capture pleine page historique. Les captures et le journal Axe ne constituent donc pas une équivalence pixel avec l'ancien spécialiste.

La sélection et les fixtures sont enregistrées dans les preuves métier, sans jeton portail. Les JSON de résultats sont écrits avant les assertions pour conserver aussi les valeurs qui échouent. Les captures SDK et la preuve métier sont prises en charge par l'archive du wrapper. Aucun test isolé supplémentaire n'est ajouté : il s'agit d'un port direct du spécialiste navigateur existant, dont les assertions doivent être exécutées dans le navigateur.

Le port n'est pas qualifié par sa collecte ou son typage. Une exécution explicite des routes choisies est requise ; elle ne permet aucune conclusion sur les 56 écrans entiers.

Les premiers rejeux restent rouges et archivés : candidate7 refusait l'installation
du script avant ouverture d'une page ; candidate9 exécute les vingt viewports
sélectionnés et révèle deux contrastes insuffisants sur les boutons d'ajout d'une
commande. Candidate10 atteint parfois sa mesure avant la fin du flux de page et
observe zéro h1 : le profil rend bien « Mon profil » aux trois premières largeurs,
puis montre encore le chargement à la quatrième. Le port attend désormais
exactement un h1 visible avant fonts/animations et conserve ensuite tous les
contrôles exacts. Aucun échec de contraste n'est exclu ni classé en succès.
