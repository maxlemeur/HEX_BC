# Émission d’offre : défaillances et preuves avant modification

Cas définis le 13 octobre 2026 avant toute modification du produit email/portail.
Préparation locale uniquement : l’application utilise le SDK Resend réel dirigé vers
un collecteur HTTP loopback strict ; aucune livraison externe. Le test indépendant
du SDK a observé le refus 422 du contenu Buffer JSON et l’acceptation du même PDF
encodé en base64. Cela ne prouve pas encore l’émission depuis l’application.

| Cas | Défaillance observable | Assertion décisive |
| --- | --- | --- |
| OF00 | La confirmation UI échoue avant la réception du PDF ou marque envoyé sans réception. | POST `/send` réel 200, messageId égal au reçu durable, version sent, PDF ready avec le même SHA que la pièce jointe. Prix 20/4/24 EUR enregistrés avant envoi. |
| OF0L | Le formulaire reprend le verrou d’une autre page ou permet la soumission sans son propre bail. | Bail réel avec une autre identité de page sur le même ARMY ; formulaire bloqué, aucun `/send` ni reçu, aucun takeover, bail concurrent inchangé. Libération exacte par sa session en fin de fixture. |
| OF01 | Le bouton de l’email mène au tableau de bord exigeant une connexion, ou à un autre devis. | Ouvrir l’URL extraite du vrai HTML dans un contexte vidé de ses cookies ; route `/portal/`, aucune Connexion, nom original, V1 et total 24 EUR. Aucun token préparé en base. |
| OF02 | Après édition de l’affaire, le renvoi mélange ancien PDF et nouveau nom. | Émettre une autre offre, modifier réellement nom/client/référence/site dans l’interface, renvoyer : PDF même SHA, titre HTML et texte au nom ORIGINAL. Sujet/message libres identiques et neutres. |
| Annulation | Ouvrir/fermer le formulaire déclenche une émission. | Zéro POST `/send`, zéro reçu supplémentaire avant confirmation. |
| Conservation | La réception contient un PDF différent de celui publié. | Bytes PDF, SHA256 et statut document comparés au reçu, pas simplement téléchargement non vide. |
| Confidentialité | La capacité anonyme apparaît dans les rapports/logs. | URL/token conservés dans un pointeur privé ; remplissage par secrets opaques SDK, navigation via formulaire utilitaire, artefacts publics expurgés. Aucune capture après saisie secrète. |

OF00 sera exécuté avant toute correction du format de la pièce jointe. Si une
précondition, un verrou, un droit ou une génération PDF manque, cette exécution
ne prouve pas le défaut de transport : conserver le résultat et diagnostiquer.
OF01/OF02 exigent d’abord une véritable réception. Un échec de transport signifie
preuve manquante pour le portail et le renvoi, pas un RED de leurs assertions.

Le harnais de navigation peut remplir une page utilitaire locale pour enregistrer
les secrets dans le SDK avant navigation. Il ne simule aucune réponse métier,
aucune API `/send`, aucune RPC, aucun email reçu, aucun statut/token final.

Les fixtures sont nouvelles et préfixées ARMY. Le compte, ses rôles et son profil
existants restent intacts. Les cas de changement d’émetteur/CGV et les courses
transactionnelles sont spécialistes préparés séparément ; leur définition
seule ne les qualifie pas. Les recettes historiques restent inchangées.

Première exécution OF00 du 13 octobre, archive `11-49-31-910Z-29b1c11c…` :
connexion réussie, valeurs 2000/400/2400, fermeture réelle de l’éditeur et DELETE
du bail réussis, puis confirmation depuis la fiche → 409 LOCK_REQUIRED,
zéro reçu et aucun appel collecteur. C’est un défaut du parcours d’émission
depuis la fiche, pas encore le RED Buffer du transport. Avant correction : le
formulaire doit acquérir/renouveler son propre bail de brouillon et transmettre
son identité de page au `/send`. Il ne force aucun verrou. Un renvoi de version
sent ou une reprise sending ne doit pas acquérir un bail de brouillon.

Deuxième OF00, archive `11-59-32-257Z-2473890c…` : le bail fonctionne,
puis 400 ESTIMATE_GATING_BLOCKED / no_pdf_generated, zéro reçu. C’est une
précondition PDF manquante dans la recette. OF00/OF01/OF02 préparent désormais
le PDF via le bouton de l’affaire et le vrai dialogue de mise en page. Aucun
contrôle métier n’est supprimé pour atteindre le transport.

Troisième OF00, archive `12-06-28-576Z-5239ace0…` : PDF préparé par UI,
bail acquis, vrai appel SDK au collecteur puis 500
ESTIMATE_EMAIL_PROVIDER_REJECTED, zéro reçu. La lecture limitée du dispatch
confirme failed / validation_error, sans providerId, avec les totaux
2000/400/2400 conservés. Reçu de diagnostic
`.e2e/offer-emission/diagnostics/red-buffer-20261013-01/receipt.json`.
Les assertions de format des deux tests outbox existants sont adaptées AVANT
le correctif produit ; les vraies assertions HTTP/PDF OF00 restent l’oracle.

## OF04 — émission manuelle depuis la fiche, précode

Défini avant le branchement manuel Doc1/Seal5 et avant la correction du bail du
bouton. Une nouvelle ARMY est chiffrée par le vrai éditeur à 2000/400/2400 centimes,
puis son PDF est préparé par le dialogue réel de l’affaire. Après retour à la
fiche du devis `/dashboard/estimates/:id`, le vrai bouton **Marquer envoyé** doit
émettre exactement un PATCH `/status`, avec le jeton If-Match de la version et
l’identité de son propre bail de page. Aucun forçage, emprunt de bail ou requête
API directe destinée à remplacer le clic n’est admis.

Le témoin conserve le statut et le code d’erreur réels AVANT les assertions. Un
409 LOCK_REQUIRED reste un RED du parcours; une préparation PDF absente ou une
réponse manquante reste une précondition manquante. Le résultat attendu est
HTTP200, version `sent`, `seal_payload_version=5` réellement lu par le GET
authentifié existant, hash de sceau présent, totaux inchangés, badge **Scellé** et
**Envoyé** après rechargement. Le PDF FINAL ready fournit un SHA et une taille
réels. La prévisualisation UI reste une précondition; sa régénération finale
avec `force:true` peut changer les octets/métadonnées PDF et ne constitue pas un
défaut. Aucun droit, bail ou gating d’émission n’est contourné.

L’action ne fait aucun POST `/send`, ne provoque aucun appel réseau au collecteur
et ne crée aucun reçu email. Ces observations **ne prouvent pas** l’absence de
ligne outbox ou de token. Doc1 et les comptes email/token doivent être vérifiés
ensuite par le root sur les seuls IDs ARMY conservés, avec sa lecture locale
indépendante bornée et des champs privés expurgés. Le harnais indique cette
preuve complémentaire comme manquante; il ne fabrique pas un nouveau endpoint
QA, ne lit aucun JWT et n’utilise pas de service-role dans le navigateur.

Après cette émission manuelle, OF04 poursuit le cycle existant par les vrais
boutons **Marquer accepté**, puis **Archiver**, avec rechargement après CHAQUE
transition. Ces deux défaillances sont définies avant la correction du wrapper
serveur : un wrapper qui omet la preuve du document ou le numéro du sceau sur
`sent→accepted→archived` doit faire échouer la recette. Chaque PATCH doit réussir
avec son propre If-Match courant; statut, badge et GET doivent correspondre à
`accepted`, puis `archived`. Les totaux, le hash de sceau, son marqueur5 et le
SHA/taille du PDF FINAL après `manual-sent` restent strictement identiques. Aucun POST `/send`, appel ou
reçu collecteur ne doit apparaître.

Le guard du harnais n’admet `accepted` et `archived` que pour l’ID ARMY OF04
explicitement armé juste avant son clic, dans cet ordre, une requête à la fois,
avec un corps contenant uniquement `status`. Les décisions de portail et les
autres versions restent interdites. Cette admission locale ne modifie ni RLS,
les droits utilisateur, ni les guards produit. Le complément root sur les
comptes email/token et Doc1 reste nécessaire pour qualifier l’absence de lignes
persistées, également après les deux transitions.

## OF03 — confidentialité et présentation du portail, précode

Défini avant le nouveau rendu public. Une autre ARMY est réellement émise puis
ouverte par le lien de l’email collecté, sans cookies. Le portail doit restituer
le nom, les lignes, quantités/unités, prix de vente et totaux originaux, ainsi que
les colonnes choisies et les CGV d’origine lorsqu’elles sont effectivement
jointes. Le contrôle compare le portail au document et aux options demandées;
il ne régénère pas l’offre à partir d’un profil ou d’un modèle courant.

Les réponses HTML/RSC et le DOM sont inspectés dans le contexte anonyme sans en
exporter les corps. Toute clé de coût, marge, paramètres MO, rôle/tarif fournisseur,
contexte de calcul privé ou snapshot brut est une fuite. Les artefacts publics
contiennent seulement noms de clés trouvées, booléens, statuts, tailles et hashes.
Les prix de vente FO/MO éventuellement choisis restent distincts des coûts et
heures internes. Le GET anonyme de l’API interne du devis doit refuser et ne
retourner aucune donnée. Aucune réponse portail/RPC n’est simulée; aucun token
n’est seedé, et aucune capture n’est prise après remplissage de capacité secrète.

Les cas ajoutés sont **préparés, non exécutés** tant qu’un nouveau manifeste
d’exécution ne les rapporte pas. Leur découverte ou leur source n’est pas une
preuve métier. La comparaison intégrale Doc1/CGV originale et les comptes DB
restent à compléter par la lecture indépendante du root si le GET existant ne
fournit pas ces champs.

## Préparation du PDF de brouillon v2 — correction en cours

La recette OF04 du 13 octobre s'est arrêtée avant le cycle manuel : publication refusée pour OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH. La lecture réelle trouve un brouillon v2 révision9 et totaux20/4/24€, sans contexte ni prix figés. Cet échec ne qualifie pas encore le contrôle du bail lors du changement de statut.

La correction prépare la projection avec le calcul existant et une RPC document additive, service-only/invoker, qui contrôle le bail exact de la page avant de déléguer au gel commercial arrondi. Le gel précède le claim et la version est relue. Aucun statut, sceau, email, token ni approbation n'est créé par la préparation. Le publisher Doc1 et le sceau5 restent stricts. Les défaillances et assertions SQL spécialisées sont définies avant la migration; les assertions bail/interface sont préparées avant les changements UI. À ce stade cette correction n'est pas qualifiée par un PDF réel réussi, et la nouvelle migration n'est pas appliquée.
