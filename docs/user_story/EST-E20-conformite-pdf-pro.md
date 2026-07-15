# EST-E20 — Conformite reglementaire & PDF professionnel

> Milestone: M5 | Priorite: P1 | Statut: A faire

## Objectif

Assurer la conformite reglementaire des devis avec la multi-TVA (taux reduits renovation 20%/10%/5.5%), les mentions legales obligatoires (assurance decennale, SIRET, RCS, conditions de paiement), une page de garde professionnelle avec recapitulatif detaille, et une bibliotheque de conditions generales et particulieres rattachables au devis.

## Ce qui existe deja

- **TVA par ligne** : colonne `tax_rate_bp` sur `estimate_items` — le schema supporte deja un taux par ligne, mais il n'y a pas de logique metier pour les taux reduits ni de recapitulatif multi-TVA.
- **PDF serveur** : `EST-201` — generation PDF cote serveur avec `src/app/dashboard/estimates/[versionId]/print/page.tsx`.
- **Parametres tenant** : table `tenants` — informations entreprise basiques.
- **Quality gating** : `EST-E08` — verification avant envoi.

---

## EST-351 — Multi-TVA (20%/10%/5.5%) avec recapitulatif

**Priorite:** P0 | **Effort:** M | **Milestone:** M5

### User Story

> En tant que chiffreur, je veux appliquer automatiquement les taux de TVA reduits (10% renovation, 5.5% amelioration energetique) selon la nature des travaux, et afficher un recapitulatif multi-TVA dans le devis, afin de respecter les obligations fiscales et de produire un document conforme.

### Criteres d'acceptation

- [ ] Configuration des taux de TVA disponibles au niveau tenant : 20% (standard), 10% (renovation), 5.5% (amelioration energetique), 0% (export/DOM-TOM)
- [ ] Application du taux par ligne : le champ `tax_rate_bp` existant est utilise, avec un selecteur de taux dans l'editeur
- [ ] Taux par defaut configurable au niveau du devis (ex: 10% pour un chantier renovation)
- [ ] Recapitulatif multi-TVA dans le PDF : tableau "Base HT | Taux TVA | Montant TVA | Total TTC" par taux
- [ ] Le total general TTC = somme des totaux TTC par taux
- [ ] Validation : alerte si un devis renovation utilise le taux standard 20% sur des lignes normalement eligibles au taux reduit
- [ ] Compatibilite avec les sous-totaux par section (EST-121) : les sous-totaux affichent le taux TVA predominant
- [ ] Mention legale automatique sur le PDF : "TVA sur travaux de renovation selon art. 279-0 bis du CGI" si taux 10% applique

### Notes techniques

- Fichiers a modifier : `src/components/estimates/EstimateEditorRow.tsx` (selecteur TVA), `src/lib/estimate-calculations.ts` (totaux par taux), `src/app/dashboard/estimates/[versionId]/print/page.tsx` (recapitulatif multi-TVA)
- Migration DB : table `vat_rates` (tenant_id, rate_bp, label, legal_reference, is_default)
- Reutiliser : `tax_rate_bp` existant sur `estimate_items`, `computeEstimateTotals()` a enrichir
- Dependances : aucune

---

## EST-352 — Mentions legales obligatoires sur devis

**Priorite:** P1 | **Effort:** S | **Milestone:** M5

### User Story

> En tant qu'admin, je veux que les devis generes incluent automatiquement toutes les mentions legales obligatoires (assurance decennale, SIRET, RCS, conditions de paiement, penalites de retard, garantie de parfait achevement), afin d'etre en conformite avec la reglementation francaise.

### Criteres d'acceptation

- [ ] Configuration des mentions legales au niveau tenant : formulaire d'edition dans les parametres entreprise
- [ ] Mentions obligatoires avec champs structures : SIRET, RCS, capital social, assurance decennale (compagnie, numero, couverture), qualification RGE (numero, organisme)
- [ ] Mentions automatiques sur le PDF : conditions de paiement, penalites de retard (taux legal), escompte, droit de retractation (si applicable)
- [ ] Validation : alerte quality gating (EST-141) si des mentions obligatoires sont manquantes dans les parametres tenant
- [ ] Les mentions sont positionnees en pied de page ou en derniere page du devis PDF
- [ ] Modele de mentions par defaut fourni a la creation du tenant

### Notes techniques

- Fichiers a modifier : `src/app/dashboard/estimates/[versionId]/print/page.tsx` (bloc mentions legales), parametres tenant
- Migration DB : colonnes structurees sur `tenants` ou table `tenant_legal_info`
- Reutiliser : parametres tenant existants, quality gating EST-141
- Dependances : aucune

---

## EST-353 — Page de garde et recapitulatif detaille

**Priorite:** P1 | **Effort:** M | **Milestone:** M5

### User Story

> En tant que chiffreur, je veux que mon devis PDF inclue une page de garde professionnelle avec un recapitulatif par lot, une decomposition FO/MO/ST, et les informations du projet, afin de presenter un document de qualite professionnelle au client.

### Criteres d'acceptation

- [ ] Page de garde du PDF : logo entreprise, coordonnees, informations client, reference devis, date, objet du chantier
- [ ] Recapitulatif synthetique : tableau par lot (EST-341) avec montant HT, TVA, TTC
- [ ] Decomposition par nature de cout : fournitures, main d'oeuvre, sous-traitance (optionnel, masquable)
- [ ] Graphiques optionnels : camembert repartition par lot, histogramme FO/MO/ST
- [ ] Informations projet : adresse chantier, maitre d'ouvrage, maitre d'oeuvre, date debut prevue, duree estimee
- [ ] Mise en page configurable : choix des blocs a afficher, ordre des sections
- [ ] Sommaire automatique avec liens vers les sections du devis
- [ ] Numero de page "Page X/Y" sur chaque page

### Notes techniques

- Fichiers a modifier : `src/app/dashboard/estimates/[versionId]/print/page.tsx` (page de garde, recapitulatif)
- Fichiers a creer : `src/components/estimates/print/CoverPage.tsx`, `src/components/estimates/print/SummaryTable.tsx`
- Reutiliser : `computeSectionTotals()` pour les totaux par lot, informations tenant existantes
- Dependances : EST-341 (lots pour le recapitulatif par lot), EST-351 (multi-TVA pour le recapitulatif)

---

## EST-354 — Conditions generales et particulieres

**Priorite:** P2 | **Effort:** M | **Milestone:** M5

### User Story

> En tant qu'admin, je veux disposer d'une bibliotheque de clauses types (conditions generales de vente, conditions particulieres) rattachables a chaque devis, avec possibilite de personnaliser par devis, afin de proteger juridiquement l'entreprise.

### Criteres d'acceptation

- [ ] Bibliotheque de clauses au niveau tenant : titre, contenu (rich text), categorie (CGV, CP, technique, financiere)
- [ ] Clauses par defaut : ensemble de clauses automatiquement rattachees a tout nouveau devis
- [ ] Personnalisation par devis : possibilite d'ajouter, retirer ou modifier les clauses pour un devis specifique
- [ ] Clauses conditionnelles : certaines clauses ne s'appliquent que sous conditions (ex: clause sous-traitance uniquement si lignes sous-traitees)
- [ ] Ordre des clauses configurable (drag-and-drop)
- [ ] Les clauses sont incluses dans le PDF en annexe, apres le detail du devis
- [ ] Versionning des clauses : modification d'une clause dans la bibliotheque ne modifie pas les devis deja emis

### Notes techniques

- Fichiers a creer : `src/lib/clauses/`, `src/components/clauses/`, `src/app/dashboard/settings/clauses/`
- Migration DB : tables `clause_templates` (tenant_id, title, content, category, position), `estimate_clauses` (estimate_version_id, clause_template_id, content_override, position)
- Reutiliser : pattern bibliotheque des ouvrages, editeur rich text existant ou a integrer
- Dependances : aucune

---

## EST-362 — Referentiel normes BTP (DTU, RE2020, CCAG, CCTP, BPU)

**Priorite:** P1 | **Effort:** M | **Milestone:** M5

### User Story

> En tant que chiffreur, je veux acceder aux references normatives BTP (DTU, RE2020, CCAG, CCTP, BPU) et les rattacher a mes lignes de devis, afin de justifier mes choix techniques et de garantir la conformite reglementaire de mes chiffrages.

### Criteres d'acceptation

- [ ] Referentiel de normes integre : base de donnees des DTU, RE2020, articles CCAG, postes BPU avec code, intitule, description, lien vers le texte officiel
- [ ] Recherche dans le referentiel : par code (ex: DTU 26.1), par mot-cle, par corps d'etat
- [ ] Rattachement d'une reference normative a une ligne du devis : champ `norm_references` sur `estimate_items`
- [ ] Affichage dans l'editeur : badge ou icone indiquant qu'une ligne a des references normatives, detail au survol
- [ ] Les references normatives sont affichees dans le PDF du devis (optionnel, colonne ou note de bas de page)
- [ ] Mise a jour du referentiel : import periodique ou edition manuelle par l'admin tenant
- [ ] Referentiel partage au niveau tenant : enrichissable par les chiffreurs de l'entreprise
- [ ] Lien avec les ouvrages composes (EST-311) : un ouvrage peut avoir des normes associees par defaut

### Notes techniques

- Fichiers a creer : `src/lib/norms/`, `src/components/norms/NormSearch.tsx`, `src/app/dashboard/settings/norms/`
- Migration DB : table `norm_references` (code, title, body, category, source_url), table de jointure `estimate_item_norms`
- Reutiliser : pattern recherche du catalogue fournisseur, panel lateral existant
- Dependances : aucune
