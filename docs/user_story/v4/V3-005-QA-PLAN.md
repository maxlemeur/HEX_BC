# V3-005 — Plan de test QA : Card Plans, preuves & exceptions

## Pre-requis

- Compte admin : `maxime.michel@hydroexpress.fr` / `qM2CkK#cg4V.Uqh`
- Dev server running : `npm run dev` sur `http://localhost:3000`
- Affaires de seed disponibles (prefixe `V3005-`)

## Scenarios de test

### 1. Empty state — Affaire sans plans

**Navigation :** Affaires > chercher "NOPLAN" > ouvrir le hub

**Attendu :**
- [ ] Titre : "Plans, preuves & exceptions"
- [ ] Icone centree + titre "Importez vos plans pour lancer l'analyse"
- [ ] Description : "Les plans PDF permettent d'extraire automatiquement les metres..."
- [ ] Bouton primaire "Ajouter les plans" → navigue vers `/affaires/{id}/plans`
- [ ] Lien secondaire "Continuer sans plans" present et cliquable
- [ ] Pas de badge de statut, pas de compteurs

### 2. Plans importes, pas de job takeoff

**Navigation :** Affaires > chercher "V3005-PLANS" > ouvrir le hub

**Attendu :**
- [ ] Badge "X jeu(x)" en haut a droite
- [ ] Ligne stats : "X fichier(s) · Y Ko/Mo"
- [ ] Pas de badge de statut (aucun job)
- [ ] Pas de section "summary" (couverture / ecarts)
- [ ] CTA "Voir les plans" → navigue vers `/affaires/{id}/plans`
- [ ] CTA "Analyser les plans" present (disabled si `onLaunchMetre` absent)
- [ ] Pas de CTA "Voir les exceptions"

### 3. Job takeoff en cours (pending/processing)

**Pre-requis :** Lancer un metre depuis la card ou via "Lancer un metre" dans la toolbar

**Attendu :**
- [ ] Badge info (bleu) avec label "Analyse en attente" ou "Analyse en cours"
- [ ] Pas de section summary (coveragePercent = null)
- [ ] CTA "Voir les plans" present
- [ ] Pas de CTA "Voir les exceptions" (job pas termine)

### 4. Job takeoff termine sans exceptions

**Pre-requis :** Affaire avec job `completed` + DPGF importe + toutes les lignes matchees

**Attendu :**
- [ ] Badge success (vert) avec label "Analyse terminee"
- [ ] Summary : "X % des postes couverts" (pas de segment ecarts si 0)
- [ ] CTA "Voir les exceptions" present → navigue vers
      `/affaires/{id}/takeoff/{jobId}/review?versionId={vid}&view=dpgf&dpgfView=exceptions_only`
- [ ] Verifier que `versionId` dans l'URL correspond a la version courante (pas la source)

### 5. Job takeoff termine avec exceptions (review_required)

**Pre-requis :** Affaire avec job `completed` + lignes DPGF non couvertes ou ecarts significatifs

**Attendu :**
- [ ] Badge warning (orange) avec label "Analyse a verifier"
- [ ] Summary avec icone warning : "X % des postes couverts — Y ecart(s) majeur(s)"
- [ ] CTA "Voir les exceptions" present et fonctionnel
- [ ] Apres validation d'exceptions dans la review UI, revenir au hub → le compteur doit
      avoir diminue (fix #1 : review decisions prises en compte)

### 6. Job takeoff echoue

**Pre-requis :** Job en statut `failed` avec un `error_code` connu

**Attendu :**
- [ ] Badge error (rouge) avec label "Analyse echouee"
- [ ] Sous le badge : label fonctionnel (ex: "Delai depasse", "Fichier invalide", etc.)
- [ ] Pas de section summary
- [ ] Pas de CTA "Voir les exceptions"

**Mapping des error_code a verifier :**

| error_code | Label attendu |
|-----------|--------------|
| `TAKEOFF_FILE_TYPE_INVALID` | Fichier invalide |
| `TAKEOFF_FILE_TOO_LARGE` | Fichier trop volumineux |
| `AI_SCHEMA` | Extraction incomplete |
| `AI_TIMEOUT` | Delai depasse |
| `AI_SAFETY` | Contenu bloque |
| `TAKEOFF_LEVEL_C_BUDGET_EXCEEDED` | Budget depasse |
| (autre/inconnu) | rien affiche |

### 7. Etat degrade (erreur compare engine)

**Pre-requis :** Difficile a reproduire manuellement — couvert par test unitaire
`"returns null coverage when compare engine fails (degraded state)"`

**Attendu :**
- [ ] Badge warning "Analyse a verifier" (pas "done")
- [ ] Texte italique "Couverture indisponible" a la place du summary
- [ ] CTA "Voir les exceptions" toujours present

### 8. Version portee (carry-over)

**Navigation :** Affaires > chercher "V3005-CARRY" > ouvrir le hub

**Attendu :**
- [ ] Le `reviewVersionId` dans le lien "Voir les exceptions" pointe vers la version
      courante (pas la version source du job)
- [ ] Le compare utilise la version courante pour charger les review decisions

### 9. Accessibilite

- [ ] Tous les CTAs accessibles au clavier (Tab + Enter)
- [ ] `aria-live="polite"` sur le summary (verification DOM)
- [ ] Focus visible sur les boutons et liens (`:focus-visible` ring)
- [ ] Statut communique par texte + icones (jamais couleur seule)
- [ ] Card lisible sur viewport mobile (pas de tableau)

## Tests automatises

Tous les scenarios serveur sont couverts par `src/lib/affaires/server.test.ts` (30 tests) :

```bash
npx vitest run src/lib/affaires/server.test.ts
```

Les tests couvrent :
- Plans summary avec job completed + coverage/exceptions
- Empty plans (no plan set, no job)
- Pagination des fichiers plans
- Status mapping (pending → running, completed → done/review_required, failed, canceled)
- failureReasonLabel connu et inconnu
- Etat degrade (compare engine failure → null coverage → review_required)
- Version portee (reviewVersionId resolution)

## Gap connu

- Pas de tests composant RTL pour `PlansMetresCard` — a ajouter en follow-up
- `openQuestionsCount` toujours 0 (stub — pas de table hypotheses)
