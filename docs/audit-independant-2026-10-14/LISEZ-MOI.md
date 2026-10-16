# Audit indépendant du 14 octobre 2026

Restitution de l'audit demandé par le dossier `docs/handoff-prestataire-2026-10-14/`.

| Fichier | Pour qui | Contenu |
|---|---|---|
| `rapport-audit-independant.docx` (et `.pdf`) | Porteur du projet | Appréciation globale, points solides, écarts, arbitrages proposés, priorités, chemin de réalisation, conditions de mise en service |
| `annexe-technique.md` | Équipe technique | Constats numérotés avec statut, gravité et preuve ; résultats outillés ; affirmations antérieures confirmées ou infirmées ; reproduction |
| `registre-audit.csv` | Porteur et équipe | Registre de questions d'origine complété (Q01 à Q12) et quatre questions ajoutées ; décision du porteur du 16/10/2026 (colonne `decision_porteur`). Ce fichier fait foi : le générateur `reproductions/outils/rapport/make-registre.py` est périmé (sans `decision_porteur` ni les corrections ultérieures) et ne doit pas être relancé |
| `rapports-axes/` | Équipe technique | Rapports détaillés : règles et calculs (D1), ergonomie et continuité (D3), matériaux métier (D4), exploitation (D5), parcours rejoués (C) |
| `reproductions/` | Équipe technique | 24 tests de caractérisation, scripts de la pile locale isolée, résultats bruts |
| [`lot1/LISEZ-MOI.md`](lot1/LISEZ-MOI.md) | Porteur et équipe | Archive (16/10/2026) : travail local du lot 1 et de la migration RLS des adhésions (S-09, appelée « étape 0 du lot 2 » le 14/10, sans rapport avec le sous-lot 2.0 de la conception), jamais publié, conservé sous forme de patch ; distinct du « Lot 1 » de dette technique des développeurs |
| [`lot2/conception-lot2-moteur-v3.md`](lot2/conception-lot2-moteur-v3.md) | Équipe technique | Conception du lot 2 (moteur de calcul v3, arbitrages de calcul), validée par le porteur le 16/10/2026 et recalée sur `98408ef0` ; rien n'est implémenté |

Référence auditée : archive SHA-256 `21b2a341…` (commit `ce5874f5` plus le travail non commité capturé à 13 h 19).
Les évolutions postérieures du dépôt ne sont pas auditées.

**Décisions du porteur (16/10/2026)** : les 14 arbitrages du rapport (§6) et les points de décision du lot 2
sont validés tels que proposés. Plusieurs questions du registre attendent encore une désignation du porteur
(Q01, Q04, Q08, Q09, Q11 : colonne `decision_porteur`). La sécurité est hors périmètre pour l'instant
(développement, données fictives). Les actions immédiates ci-dessous, qui relèvent de la sécurité et de
l'exploitation, restent à mener avant tout usage réel, après revérification sur l'état actuel du dépôt, non
audité : la CI de test vise une pile Supabase en boucle locale depuis `a25b5c40` (`e2e-army-critical.yml`,
`e2e-army-full.yml`) ; restent à vérifier hors dépôt le retrait de la clé service-role de production des
secrets GitHub et la purge des données de test déjà écrites en production. Le travail non commité de l'audit
a été publié sur `main` par `28ccc857` ; le travail se poursuit sur `main` par petits commits, chacun relu par
un humain avant publication (Q12), et la protection de `main` est différée. Avant tout usage client réel :
avis de l'expert-comptable sur la TVA et les arrondis, et d'un juriste sur les mentions (Q06).

**Actions immédiates recommandées** : rendre le dépôt GitHub privé ; changer les mots de passe exposés
(historique Git, classeur `docs/prd_file/Feuille de calcul sans titre.xlsx`) ; arrêter les écritures de la CI
en production ; mettre en place une sauvegarde chiffrée et la restaurer une fois ; pousser le travail non commité
sur une branche privée et protéger `main`.

Ce dossier ne contient aucun secret. Les identifiants des comptes de test de la pile locale sont restés dans le
dossier temporaire de l'auditeur, et cette pile a été détruite à la fin de l'audit.
