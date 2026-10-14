# Émission manuelle et bail de page

La transition d'un brouillon vers « envoyé » utilise
`transition_estimate_draft_to_sent`. Elle contrôle le token de concurrence
PostgreSQL exact et le bail tenant/version/utilisateur/session, puis vérifie
son expiration avec `clock_timestamp()` après les attentes de verrouillage.
Elle délègue à la transition existante les contrôles du document, du sceau et
l'écriture atomique de l'événement. Les transitions suivantes gardent leur
contrat existant. Une autre page du même utilisateur ne possède pas ce bail.

La migration additive est
`20261013210744_estimate_manual_emission_session.sql` (SHA256 `29920bd60fd79c8a6ff7f170793a6ff3fa26bde8324581c38fca7945575fa3f1`).
Les anciennes fonctions, leurs OID et leurs droits restent inchangés. La
nouvelle fonction est `SECURITY INVOKER`, avec chemin de recherche vide et
exécution réservée à `service_role` ; le serveur contrôle l'utilisateur.

## Régressions et résultats locaux du 13 octobre 2026

La fixture `src/test/fixtures/estimate-manual-emission-session-regression.sql`
reprend exactement les 45 cas définis avant la migration, avec une correction
du setup v2. Le moteur v2 est fixé à l'insertion : le premier setup tentait
une modification interdite, confirmée par le diagnostic original
`ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE`. Les deux échecs et leur rollback sont
conservés ; les oracles financiers et les branches négatives n'ont pas changé.
SHA256 de la fixture corrigée :
`18996f10b5c019c1f054fbd7e56f00c80b0ccc5a60c3d9a7ac8cae0a92eb6dad`.

Le contrat historique passe 36/45 cas : trois lacunes sur la session et
l'horloge, plus six différences intentionnelles du nouveau contrat. Le
candidat et la fonction installée passent 45/45. Les cas couvrent aussi le
token à une microseconde, les autorisations, le tenant et le projet actifs,
le document et le sceau, le prix zéro et la MO zéro avec heures conservées.
Chaque recette finit par P9001 et vérifie indépendamment la conservation de
toutes les colonnes courantes, catalogues, historique, fonctions/procédures,
corps, OID et ACL.

La migration est appliquée une seule fois sur la pile native locale
API `127.0.0.1:45585` / DB `127.0.0.1:33485`, après répétition annulée et
revues. Reçus sous `.e2e/offer-emission/` :

- candidat : `manual-session-sql-runs/candidate-20261013-02/receipt.json`, `ac44eacf…` ;
- répétition : `manual-session-application-rehearse-20261013-01/receipt.json`, `21dc3029…` ;
- application : `manual-session-application-local-20261013-01/receipt.json`, `77daddd0…` ;
- lecture indépendante : `manual-session-application-independent-20261013-01/receipt.json`, `1de3349b…` ;
- installé sans DDL : `manual-session-sql-runs/installed-20261013-01/receipt.json`, `177a030c…`.

## Reproduction et limites

Le paquet local gelé
`.e2e/offer-emission/manual-session-application-precode-20261013-01/`
conserve les commandes exactes et leurs admissions. Sur Windows, utiliser
Python dans WSL Ubuntu-24.04, utilisateur `tanuki`, depuis ce checkout.
`manual-session-precode-20261013-01/run-v2.py --mode installed` n'exécute
aucun DDL ; son admission exige le runtime exact et les sources gelées.
Le paquet est un artefact local, pas un runner portable de CI.

Ne jamais exécuter la fixture directement sur une base partagée ou distante.
Les identités dédiées sont temporaires et la transaction doit être annulée.
Une application incertaine exige une lecture indépendante ; ne pas rejouer
la migration. Le marqueur de commit est écrit et synchronisé avant son envoi.
Ne pas réinitialiser la pile native ni modifier ses droits pour une recette.

Ces cas SQL ne prouvent ni une course à deux connexions, ni les octets réels
du PDF, ni son sceau cryptographique. Le parcours navigateur OF04 et ses
lectures complémentaires doivent fournir ces preuves documentaires.
La qualification locale ne vaut pas recette globale ni mise en service.

OF04 est maintenant qualifié sur la compilation locale de production
`rS5WcBA3mpWmfmauKcsfm` du 13 octobre 2026. Le parcours envoyé → accepté →
archivé conserve les montants après rechargement et ne crée ni email, ni
capacité, ni approbation, ni revue. La lecture indépendante télécharge le
PDF réel de Storage, compare ses octets au hash et à la taille observés dans
l'interface et recalcule le vrai builder v4 puis le sceau v5. Les ancres et
montants de la copie commerciale sont aussi contrôlés. Qualification :
`.e2e/offer-emission/of04-admission-qualified-20261013-01/qualification.json`,
SHA256 `62e3775cbc755cf2feb950c5a735807ccfed363680d3c53172e0e9208ff53861`.
L'archive contient 2 255 artefacts contrôlés ; les 13 autres cas filtrés ne
sont pas revendiqués. Cette preuve ne lit pas le texte physique du PDF et
ne couvre pas une course à deux connexions ni des CGV approuvées.
