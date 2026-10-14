# Phase C — Parcours rejoués sur la pile locale isolée (14/10/2026, 15 h 05 – 15 h 30)

Environnement : copie figée de l'archive (SHA-256 21b2a341…) servie par `next dev` 16.4 (Turbopack) sur
127.0.0.1:3210 ; Supabase CLI 2.120.0 runtime natif dans WSL Ubuntu-24.04, projet `audit-independant-20261014`,
ports 563xx ; 242 migrations SQL de l'archive appliquées par `db reset` sans erreur. Aucune clé Gemini, Resend,
Vercel. Comptes de test créés par inscription locale : entreprise A (admin, engineer, viewer, director),
entreprise B (admin). Connexion par relais local (le mot de passe ne transite pas par la conversation).

| # | Scénario | Résultat observé | Statut |
|---|---|---|---|
| P-01 | Création d'affaire (admin A) | L'affaire ouvre directement un devis V1 vide en saisie manuelle. Bandeau « anomalies bloquantes » dès le devis vide ; la carte « Prix — Toutes les lignes ont un prix FO valide » s'affiche en rouge/prioritaire alors qu'il n'y a aucune ligne. | Confirmé |
| P-02 | Réouverture du devis après reconnexion | « Verrouillé par vous dans un autre onglet ou appareil » ; aucune action pour reprendre la main ; il faut attendre l'expiration du bail (120 s, `DRAFT_LOCK_TTL_SECONDS`). Une saisie faite pendant le verrou (titre du lot) est perdue. | Confirmé |
| P-03 | Ajout d'un lot | Alerte transitoire « Les totaux n'ont pas pu être sauvegardés… » puis retour à « À jour » sans action. | Confirmé (transitoire) |
| P-04 | API sans bail d'édition | Toute écriture exige un bail actif propre à la page (`x-estimate-draft-lock-session-id`) : 409 sinon. Protection effective contre les écritures concurrentes. | Confirmé (point solide) |
| P-05 | EU01 dans l'interface | 3 lignes CVC (HT 19 954,50 €), remise saisie 1,01 € → total affiché 19 953,49 € ; après « Enregistrer le paramétrage » et rechargement : `discount_bp = 1`, `total_ht_cents = 1 995 250` (19 952,50 €), TVA 3 990,50 €. | Confirmé |
| P-06 | PDF du devis (entreprise de test A) | En-tête : siège social, SIRET, n° TVA intracommunautaire, adresse d'établissement et téléphones de HYDRO EXPRESS codés en dur ; référence `HEX_D26001AA`. Ligne « Tube cuivre … 120 ml × 18,40 € = 2 207,78 € » (120 × 18,40 = 2 208,00) : la remise est fondue dans les lignes (moteur v2) et n'apparaît pas en tant que remise. Aucun coût, coefficient ni marge interne. Pas de CGV ni de mention d'assurance décennale dans ce PDF d'une page. | Confirmé |
| P-07 | Envoi e-mail sans clé Resend | 500 « Configuration email manquante: RESEND_API_KEY. » ; la version reste `draft`. Échec propre, mais message technique. | Confirmé |
| P-08 | Passage en « envoyé » sans forçage | 400 `ESTIMATE_GATING_BLOCKED` : approbation requise au-delà de 5 000 € HT (comparateur `<=` : 5 000,00 € pile n'exige pas d'approbation). | Confirmé |
| P-09 | Passage en « envoyé » forcé par un admin | 200 : version `sent`, scellée, `approval_status = not_required` alors que la règle exigeait une approbation ; marge 0 % ; aucun envoi réel ni jeton de portail créé. | Confirmé |
| P-10 | Immuabilité après envoi | Ajout et modification de ligne : 403 « lecture seule » ; retour `sent → draft` refusé (400). | Confirmé (point solide) |
| P-11 | Isolation entre entreprises (admin B → devis de A) | Lecture, lignes, PDF, PATCH : 404 « introuvable » ; pages dashboard rendues en « introuvable ». | Confirmé (point solide) |
| P-12 | Annuaire inter-entreprises (admin B) | `GET /api/memberships?search=audit` renvoie nom et e-mail des 4 utilisateurs de l'entreprise A. | Confirmé (R1) |
| P-13 | Rattachement forcé d'un utilisateur de A dans B | 409 : l'insertion tente `is_default = true` car le comptage passe sous RLS (0 adhésion visible) et heurte l'index unique `tenant_memberships_single_default_idx`. Protection par effet de bord, non voulue. | Confirmé |
| P-14 | Droits internes à l'entreprise A | Le chiffreur (engineer) voit « 0 affaires » et reçoit 404 sur les devis de l'admin ; le lecteur (viewer) 404 en lecture ; la direction voit l'affaire au tableau de bord mais 404 sur le devis. Visibilité par propriétaire, pas par entreprise. | Confirmé |
| P-15 | Lecture des DPGF réelles par l'analyseur d'import (fonction pure) | HEX (171 lignes, en-têtes FO/MO, Qté atelier/chantier, PU MO atelier/chantier), OPTIMA hydraulique (2 947) et plomberie (1 396) lues avec les bons en-têtes. Structure lot/ligne non évaluée à ce stade. | Confirmé (partiel) |
| P-16 | Portail client | Aucun jeton créé sans service e-mail : portail non rejoué à l'exécution (revue de code seulement). | Non audité (exécution) |

Non rejoués faute de temps ou d'accès : import DPGF complet par l'interface (sélecteur de fichier), collage Excel
dans la grille, ouvrages/sous-détails, approbation par la direction, bons de commande, montée en charge 1 000 lignes,
deux onglets simultanés au-delà du constat C-02.
