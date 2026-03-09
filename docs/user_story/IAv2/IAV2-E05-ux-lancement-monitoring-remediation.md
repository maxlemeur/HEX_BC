# IAV2-E05 — UX lancement, monitoring, remediation

> Priorite: P1 | Effort: M | Cible: rendre le comportement comprehensible pour le chiffreur

## Objectif

Rendre le module IA actionnable sans connaissance technique:
bon niveau recommande, bon document attendu, bon etat visible, bonne action de reprise.

---

## IAV2-041 — Assistant de choix du niveau et du document

### User Story

> En tant que chiffreur, je veux que l'application me guide vers le bon niveau d'analyse,
> afin d'eviter de lancer un mode inadapté a mon document.

### Criteres d'acceptation

- [ ] Recommandation claire `A/B/C`
- [ ] Explication simple:
  - document tabulaire
  - PDF avec tableaux
  - plan complexe / pre-estimation
- [ ] Warning si le document choisi ne correspond pas au niveau
- [ ] Le plan set multi-fichiers est propose quand pertinent

### Edge cases

- utilisateur choisit `C` pour un simple CSV
- utilisateur choisit `A` pour un dossier PDF de plans
- document hybride

---

## IAV2-042 — Support robuste des PDF reels terrain

### User Story

> En tant que chiffreur, je veux que mes PDF scanner ou export bureau d'etudes soient acceptes autant que possible,
> afin de ne pas etre bloque pour des raisons purement techniques.

### Criteres d'acceptation

- [ ] Fallback par extension quand le MIME est vide ou peu fiable
- [ ] Message de remediation explicite si le PDF est invalide
- [ ] Distinction entre:
  - fichier non supporte
  - PDF corrompu
  - PDF lisible mais non interpretable
- [ ] Les rejets sont suivis dans les metrics pilote

### Edge cases

- PDF sans MIME depuis drag & drop
- PDF image-only
- PDF protege ou partiellement corrompu

---

## IAV2-043 — Monitoring metier et reprise depuis le hub

### User Story

> En tant que chiffreur, je veux comprendre l'etat de mon analyse depuis le hub affaire,
> afin de savoir si je dois attendre, corriger le document ou reprendre la main.

### Criteres d'acceptation

- [ ] Etats lisibles depuis le hub:
  - en file
  - en traitement
  - en attente provider
  - review requise
  - echec a corriger
- [ ] CTA adaptes:
  - revoir
  - relancer
  - changer de niveau
  - importer un autre document
- [ ] Les messages d'erreur parlent le langage du chiffreur, pas celui du provider IA

### Edge cases

- job reussi techniquement mais peu exploitable metierement
- job echoue sur budget
- job bloque par ambiguite forte ou absence de preuves
