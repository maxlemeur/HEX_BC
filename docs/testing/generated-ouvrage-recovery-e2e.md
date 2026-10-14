# Reprise d’une application d’ouvrages — recette navigateur

Contrat écrit le 12 octobre 2026 avant les parcours et leur première exécution.
Il complète [le plan produit](generated-ouvrage-commit-recovery.md) et les deux
WFC02 rouges. Une préparation ou une collecte ne constitue pas un résultat.

Six affaires neuves de la pile locale explicitement désignée par le profil
réutilisent le propriétaire autorisé. Le seed ne crée que V2, section, fragments,
propositions et sous-détails `pending_review`. Il ne crée ni ligne financière,
application, snapshot, assemblage, reçu ni statut final. Les montants sont en
centimes, sans marge/remise/frais, TVA20%, quantité1, unité `u`.

| Cas | Gestes et faute observables | Résultat exigé |
| --- | --- | --- |
| GO01 | Reprendre et valider FO1000, appliquer ; attendre la vraie réponse réussie puis la perdre. Recharger, observer trois secondes sans action d’application, cliquer Reprendre cette opération. Modifier ensuite la quantité à2 par UI et enregistrer ; relire le reçu historique par action ordinaire. | Première lecture1000/200/1200 et une seule chaîne ligne/application/snapshot/bibliothèque ; dialogue fermé sans succès, état Résultat à vérifier, mutations bloquées. Même clé/corps/jetons après reload, seul bail renouvelable exclu de l’identité. Reprise unique ; après correction UI2000/400/2400, ancien reçu/replay ne remplace pas le courant. |
| GO02 | FO1000 ; altérer seulement les totaux d’un vrai résultat réussi après serveur. Après reload, Vérifier le résultat reçoit une enveloppe de reçu incomplète HTTP200 ; demander ensuite Abandonner la demande. | Issue inconnue conservée, aucune fausse absence, aucun POST d’application automatique ; compteur d’altération exactement1 pour chaque faute. La clôture de la même demande déjà commise renvoie le résultat positif ; elle ne supprime aucun ouvrage et laisse une seule application1000/200/1200. |
| GO03 | Revue UI FO1000 ; seconde action de revue ordinaire authentifiée portant le jeton courant et validant le coût1200, alors que le formulaire garde l’ancienne revue ; appliquer la sélection périmée puis tenter une sauvegarde1100 avec ce même ancien jeton. Recharger explicitement la revue courante1200 et appliquer. | Refus explicite REVIEW_CHANGED, premier GET0/0/0, aucun objet final ni lot orphelin, contenu1200 conservé après les deux refus. Après vraie relecture du contenu déjà validé par la deuxième action,1200/240/1440 et une seule application. Cette action utilise la session navigateur ordinaire ; elle ne prétend pas prouver deux sessions concurrentes, couvertes séparément en natif. |
| GO04 | Deux candidats FO1000 et FO2000. Valider le premier, modifier réellement son coût à1500 ; l’insertion doit être désactivée jusqu’à Revalider le sous-détail. Appliquer uniquement ce premier candidat, fermer puis recharger/reprendre et appliquer le second. | Premier état1500/300/1800, draft partiel, premier inséré et second pending ; dialogue encore utilisable. Après reload premier objet/identités inchangés, seconde revue humaine requise ; total3500/700/4200, deux applications/snapshots/assemblages distincts, draft appliqué. |

## GO05 — clôture sûre d’une demande refusée, défini avant correctif

Un cinquième témoin neuf valide1000 par UI, puis une seconde vraie action
authentifiée valide1200 alors que le formulaire garde son ancien jeton. Son
application réelle répond `GENERATED_OUVRAGE_REVIEW_CHANGED` ; seule cette
réponse est perdue, sans altérer la demande. Une troisième action ordinaire
valide1400 après cette perte. Le premier GET reste0/0/0 et sans objet final.
L’intention originale, son jeton financier et ses jetons de revue restent
conservés. Le rechargement n’applique rien ; une reprise explicite de cette
même demande échoue encore et ne peut ni effacer la demande par supposition,
ni enfermer définitivement le chiffreur dans un état inconnu.

La future clôture exige une preuve serveur durable d’absence de commit pour
la clé exacte, sous la même frontière transactionnelle que son application.
Un simple GET reçu `null`, un timeout ou un bouton local « oublier » n’est pas
une preuve suffisante. Le cas vérifiera la clôture explicite, le refus de toute
application ultérieure sous la clé clôturée, puis une **nouvelle** intention
sur la revue actuelle, avec une seule ligne/application/snapshot et le montant
actuel exact1400/280/1680. Le bouton retenu est « Abandonner la demande » ;
l’action reçoit le corps original sans bail et retourne soit le résultat
positif, soit `outcome:abandoned` avec reçu exact et `currentVersion`. Le GET
reçoit aussi cette clôture durable. Aucune faute native supplémentaire n’est
nécessaire pour ce témoin ; les courses clôture/commit restent natives. Cette
section précède l’implémentation de cette clôture.

## GO06 — deux générations locales réelles, avant correction de leur clôture

Un sixième devis V2 vide possède deux sections explicites. Aucun draft,
candidat, fragment, sous-détail ou objet final n’y est préinséré. Le premier
texte est « Fourniture tube cuivre 10 m » associé au lotA ; le second est
« Fourniture isolant thermique 6 m » associé au lotB. Deux clics réels Générer,
séparés par Nouvelle génération, doivent produire deux drafts distincts avec
quantités/unités/provenance issues du véritable fallback local. Après la
première réponse : premier draft pending, fragments actifs et un candidat
pending ; après la seconde réponse complète : premier draft discarded et ses
fragments discarded, second pending avec ses propres fragments actifs.

Les observations ordinaires sont conservées après chaque vraie réponse. La
seconde réponse n’est pas remplacée par un stub. Après fermeture et reload,
seul le second apparaît dans Reprendre un brouillon ; le reprendre retrouve
ses valeurs et ses sources. Aucune ligne financière, application, snapshot,
bibliothèque ou sous-détail validé ne doit exister sans geste humain dédié.
Le pied reste0/0/0 et aucun bulk n’est envoyé.

Précondition statique établie : le mode coverage démarre un serveur neuf,
`reuseExisting:false`, avec GEMINI_API_KEY et GOOGLE_GENERATIVE_AI_API_KEY vides
dans e2e.config.ts ; callGeminiStructured refuse la clé absente avant fetch,
puis le vrai générateur persiste `used_fallback:true`, `model:null` et aucun
token/coût de modèle. La recette vérifiera ces métadonnées et le journal de
garde réseau, en plus du compteur modèle0 du runner (ce dernier ne prouve pas
à lui seul l’absence d’appel modèle par l’application). Il n’existe pas de
parcours retained équivalent : generated-ouvrage-resume interdit toute génération.
Le mode recovery comptera donc sept résultats exacts, auth+GO01–06.

Les premières lectures API et l’observation RLS indépendante sont archivées
avant les assertions. Aucun CtrlS/réparation n’est permis pour obtenir les
montants initiaux de l’application. Le CtrlS de GO01 correspond exclusivement
à la vraie correction de quantité ultérieure. Aucun modèle n’est appelé.
Les comparaisons de demande conservent les candidats, valeurs, jetons de revue,
clé et jeton financier exacts ; le bail reste en mémoire navigateur et n’est
jamais archivé. Les traces authentifiées sont désactivées.

Les identifiants sont contrôlés par le profil/fixture ; les lectures ordinaires
de vérification couvrent lignes, draft, candidats, sous-détails, applications,
snapshots et bibliothèque. Le lecteur ne déduit ni matrice complète de droits,
ni course SQL, ni absence universelle de POST à partir de la fenêtre de3s.
Les erreurs de protocole retenues sont deux fautes concrètes, pas la totalité
des combinaisons de résultats hostiles du plan produit. Une éventuelle alerte
beforeunload liée à une intention inconnue est archivée distinctement ; après
succès confirmé, aucun acquittement de modification non sauvée n’est permis.

Revue du harnais GO06 avant exécution : le générateur charge également les
derniers templates/assemblages du propriétaire, sans filtre sur le texte saisi.
GO01–05 auront déjà créé des ouvrages ; supposer un seul fragment serait faux.
GO06 capture donc ce catalogue par lecture ordinaire avant génération, exige un
unique fragment primaire `metadata.origin=input` au texte exact et rattache
chaque fragment de bibliothèque à un objet capturé (ID, label et extrait exacts).
Le compteur de métadonnées doit égaler le nombre réel de fragments. Après la
seconde génération, tous les IDs et contenus de la première restent identiques,
avec le seul état passé à discarded (timestamp de mise à jour exclu). Les
assertions candidat, absence de revue/application et pied0/0/0 restent inchangées.

La première exécution réelle de GO01, le 12 octobre à 17:51:56 UTC, confirme
le commit après réponse perdue et la conservation après reload, puis échoue
sur `waitForResponse().text()` avec `net::ERR_ABORTED` lors de la reprise.
Son ledger conserve deux POST de la même intention ; l'état final et les
autres parcours ne sont pas qualifiés. Le SDK filtre seulement l'URL, sans
méthode ni identifiant d'action, tandis que la récupération déclenche un
rechargement. Pour les clics d'application et récupération, le harnais lit
donc une copie de la vraie réponse fetch avant sa livraison au client et
sélectionne le nom d'action exact. Aucun résultat n'est fabriqué ; status,
records, corps de demande, absence de transformation et lectures métier
restent exigés. Une nouvelle campagne complète conserve l'échec original.

Le rejeu à 18:01:26 UTC dépasse cette observation : même intention rejouée,
chaîne et montants conservés, quantité éditable. Il échoue ensuite sur le
statut « En attente » persistant pendant 15 secondes, avant nouvelle saisie.
La reprise client publie une mutation structurelle sans réinjecter les totaux
historiques ; l'observateur marque donc les totaux à sauvegarder. La branche
ouvrages ne réévalue pas ce drapeau avec le buffer réel, contrairement à la
branche batch. Le correctif doit le réévaluer sur un résultat vérifié, garder
les saisies éventuelles et conserver le blocage et l'intention jusqu'au GET
réussi. Le prochain run archive aussi le buffer local avant cette assertion,
pour distinguer ce drapeau d'éventuelles normalisations de lignes en attente.

Le run à 18:09:45 UTC passe GO01, GO02 et GO03, puis GO05 confirme la clôture
durable et le refus de l'ancienne clé. Son retour à la revue échoue sur un
bouton inexistant « Revoir le sous-détail ». L'écran réel affiche « Valider le
sous-détail » avant le chargement de la revue persistée. Le parcours doit
ouvrir ce contrôle, attendre le coût 1400 et le bouton de revue déjà validée
désactivé, puis appliquer la nouvelle intention. Il ne revalide pas la revue
pour contourner ce contrôle et conserve tous les oracles de clôture.

Le run à 18:15:41 UTC passe également GO05. GO04 confirme le pied
3500/700/4200 et conserve les quatre objets de la première application.
L'égalité de la première ligne échoue uniquement sur `updated_at`, que le
recalcul canonique avance ; les 46 autres champs, dont `created_at`, sont
strictement identiques. L'oracle de seconde application compare donc tous
ces champs et exige une date technique valide, non décroissante. Les
comparaisons après simple reload et des applications, snapshots, ouvrages
et composants restent intégrales. Le lecteur indépendant porte le même
contrat ; aucune donnée ni archive du run échoué n'est modifiée.

Le run à 18:24:05 UTC passe les six premiers résultats. GO06 n'a soumis
aucune génération : le SDK interprète `selectOption(string)` comme un
libellé, et le harnais lui a passé l'UUID du lot. Le correctif utilise
`selectOption({ value: uuid })`, comme le contrat de sélection par valeur
du SDK. Les assertions de lot, texte, provenance, remplacement et reload
restent identiques ; une nouvelle campagne complète est requise.

## Qualification locale des sept résultats

L'archive `.e2e/army/coverage/runs/2026-10-12T18-29-57-281Z` passe **7/7**
résultats sur le build Windows `1d0jBvzf6x29IoHQUi4Ey`, sans filtre, skip,
retry, flaky, modèle ou trace authentifiée. Sources et build restent stables.
GO01/02 conservent l'application exacte et redeviennent éditables avec l'état
à jour ; GO03 refuse les revues obsolètes ; GO04 conserve la première chaîne
et atteint 3500/700/4200 ct ; GO05 conserve la clôture de l'ancienne clé ;
GO06 réalise les deux générations avec leurs sources exactes, sans engagement.

La relecture indépendante du scanner strict, avec environnement pertinent
et classification explicite des deux sentinelles inutilisées, passe
24 529 contrôles et examine les 491 fichiers. Reçu :
`.e2e/army/coverage/generated-recovery-qualifications/2026-10-12T18-29-57-281Z-b530a66b/qualification.json`,
SHA `cabc614f63709c8c12fcde591fb16e83df87a0e1e1049cb945e6ae8ad0a02c85`.
L'ancien refus du `read-stage`, les campagnes échouées et leurs faits restent
inchangés. Voir [la portée exacte de la relecture](local-recipe-reader.md).

La branche partagée de récupération est aussi éprouvée par les six résultats
batch du run `2026-10-12T18-46-32-879Z`, qualifié séparément. Ces résultats ne
qualifient ni CORE-06, ni tous les changements de compte/tenant, ni une mise
en production. La preuve native et les onze courses conservent leur portée
distincte de cette recette navigateur.
