# Fixtures Team B autonomes

Défaillances observables relevées avant correction du port : US-4.3 lit une
version UUID historique et US-6.2/6.3 ouvrent une affaire UUID historique. Sur un
tenant CI neuf, ces objets sont absents ou hors RLS ; les scénarios échouent avant
leurs assertions. Sur une base déjà remplie, ils dépendent de données étrangères
au run et ne constituent pas une recette reproductible.

Les trois cas doivent créer leur projet/devis ARMY par le parcours existant,
retenir leurs identités, puis vérifier les mêmes comportements : aucune offre
inventée pour une ligne sans article ; une analyse V1 acquise et une V2 en attente
restent visibles ; une pièce ambiguë déclenche la hiérarchie de confirmation et
le lien vers l'ancien parcours reste explicite. Les seeds de reprise sont déplacés
sans changement depuis `affaire-recovery-flow` dans un helper commun. Aucun
fournisseur IA, email ou statut commercial réel n'est invoqué.

La migration de privilèges du 11 août interdit au compte authentifié de fabriquer
les états/résultats du worker. Leur préparation passe donc par le client de seed
strictement local, après vérification RLS du projet appartenant au run ; les
lectures et actions testées conservent le compte ordinaire. Les fichiers de plans
utilisent le chemin canonique tenant/plan/fichier/nom requis par la base. Les deux
scénarios de reprise existants enregistrent aussi leur V2 et le préfixe du run.

Le contrôle RLS des deux tables intake exige aussi `created_by = auth.uid()`.
Les anciennes fixtures omettaient cet auteur car leur helper pouvait utiliser le
service-role. Les prérequis Team B et cockpit fournissent maintenant l'identifiant
du compte connecté sur les uploads et documents, sans changer les privilèges.

La validation est le rejeu des trois scénarios TesterArmy sur le prochain candidat
compilé. Aucun test isolé miroir n'est ajouté. Le candidat 2, déjà copié pour sa
campagne, reste inchangé ; ces corrections appartiennent au candidat suivant.
