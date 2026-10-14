# Audit indépendant du 14 octobre 2026

Restitution de l'audit demandé par le dossier `docs/handoff-prestataire-2026-10-14/`.

| Fichier | Pour qui | Contenu |
|---|---|---|
| `rapport-audit-independant.docx` (et `.pdf`) | Porteur du projet | Appréciation globale, points solides, écarts, arbitrages proposés, priorités, chemin de réalisation, conditions de mise en service |
| `annexe-technique.md` | Équipe technique | Constats numérotés avec statut, gravité et preuve ; résultats outillés ; affirmations antérieures confirmées ou infirmées ; reproduction |
| `registre-audit.csv` | Porteur et équipe | Registre de questions d'origine complété (Q01 à Q12) et quatre questions ajoutées |
| `rapports-axes/` | Équipe technique | Rapports détaillés : règles et calculs (D1), ergonomie et continuité (D3), matériaux métier (D4), exploitation (D5), parcours rejoués (C) |
| `reproductions/` | Équipe technique | 24 tests de caractérisation, scripts de la pile locale isolée, résultats bruts |

Référence auditée : archive SHA-256 `21b2a341…` (commit `ce5874f5` plus le travail non commité capturé à 13 h 19).
Les évolutions postérieures du dépôt ne sont pas auditées.

**Actions immédiates recommandées** : rendre le dépôt GitHub privé ; changer les mots de passe exposés
(historique Git, classeur `docs/prd_file/Feuille de calcul sans titre.xlsx`) ; arrêter les écritures de la CI
en production ; mettre en place une sauvegarde chiffrée et la restaurer une fois ; pousser le travail non commité
sur une branche privée et protéger `main`.

Ce dossier ne contient aucun secret. Les identifiants des comptes de test de la pile locale sont restés dans le
dossier temporaire de l'auditeur, et cette pile a été détruite à la fin de l'audit.
