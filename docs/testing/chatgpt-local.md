# Forfait ChatGPT dans MergeOne local

La connexion personnelle utilise le flux officiel [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source).
Elle est réservée au développement, sur la boucle locale (`127.0.0.1`, `localhost`,
`::1`) au port du serveur. Un autre hôte n’est accepté que s’il figure dans
`MERGEONE_DEV_HOSTS` (noms exacts, séparés par des virgules, sans protocole, port
ni joker). Un en-tête `Host` hors liste, ou un `x-forwarded-proto` autre que
`http` ou `https`, est refusé avant d’enregistrer l’adresse de retour. Les builds
de production restent désactivés. Les connexions restent propres au compte, au tenant
et au serveur qui conserve les identifiants.

Le fournisseur impose un retour OAuth HTTP sur `127.0.0.1`. MergeOne utilise
le port réel de Next puis relaie ce retour seulement vers une origine autorisée,
où la session, le cookie de navigateur et le tenant sont vérifiés avant tout échange
de jetons. Le relais revérifie l’origine : une adresse non autorisée n’est pas
redirigée. Le serveur doit être accessible depuis la boucle locale du navigateur :
un serveur distant nécessite un transfert de port. HTTPS via un proxy vers Next
HTTP reste compatible pour un hôte autorisé ; le HTTPS natif de Next seul ne fournit
pas ce retour HTTP.

Les ressources de développement Next (dont HMR) autorisent les adresses de boucle
locale et les adresses réseau présentes sur la machine au démarrage. Cette liste
ne donne pas le droit de relayer la connexion ChatGPT. Pour un alias DNS ou un
tunnel, définir `MERGEONE_DEV_HOSTS=mergeone.dev.test,autre.dev.test` avant
`npm run dev`. Un nom listé dans `MERGEONE_DEV_HOSTS` est accepté sur le port 80 ou 443 (convient derrière un tunnel).
Cette liste accepte uniquement des noms exacts, sans protocole,
port ni joker ; les sites sans rapport restent refusés.

## Utilisation

La migration `20261023222150_chatgpt_local_takeoff_execution.sql` est requise
sur la base utilisée par le Mac pour lancer un métré ChatGPT. Son application
sur une base partagée demande une autorisation distincte. Tant qu’elle manque,
le lancement est refusé avant le téléversement et aucun job Gemini n’est créé.
La migration `20261029152340_local_chatgpt_safe_recovery.sql` est également
nécessaire pour la reprise locale des tâches expirées et du dossier. Sur une base
qui ne l’a pas reçue, la reprise échoue sans appeler les anciennes fonctions de
reprise Gemini ; ne l’appliquer à une base partagée qu’après autorisation séparée.

1. Utiliser le Node de `.nvmrc`, puis lancer `npm run dev` ou `npm run dev:chatgpt`.
   `dev:chatgpt` écoute sur `127.0.0.1`. Un autre écoute n’est possible qu’avec
   `--hostname` (ou `-H`) explicite.
2. Ouvrir `http://127.0.0.1:3000/dashboard/profile` (ou `localhost` sur le même port)
   et se connecter à MergeOne. Si le port 3000 est occupé, utiliser
   `npm run dev -- --port 3015` et ouvrir cette même adresse avec le port 3015.
   Conserver la même adresse pendant le parcours OAuth.
3. Dans **Accès IA › Abonnement ChatGPT**, choisir **Continue with ChatGPT** et consentir
   à l’utilisation du forfait avec un compte éligible. **GPT-6.1 Terra** est
   sélectionné par défaut si le compte le propose et qu’aucun modèle n’est encore
   choisi. Un choix déjà enregistré est conservé. Le modèle reste modifiable
   parmi ceux réellement disponibles pour ce compte.
4. Choisir l’**Effort de raisonnement** : Automatique conserve le réglage du
   modèle. Les niveaux supportés par Terra sont Sans raisonnement, Faible,
   Moyen, Élevé, Très élevé et Maximum (`none`, `low`, `medium`, `high`,
   `xhigh`, `max`). Le sélecteur conserve ceux annoncés pour votre compte.
   [La documentation de Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)
   indique `medium` par défaut. Les choix proposés dépendent du modèle.
   Un effort incompatible revient sur Automatique lors d’un changement de modèle,
   avec un message explicite. Les préférences sont enregistrées par connexion,
   conservées après recharge et transmises aux prochaines demandes ChatGPT.
5. **Tester la connexion** envoie une courte demande réelle, qui utilise le
   forfait. **Gérer ma consommation** ouvre les limites dans ChatGPT.

Les appels interactifs de classement des documents, brief, génération d’ouvrages,
structure et explication utilisent le compte, le modèle et l’effort sélectionnés.
Un effort supérieur peut augmenter le temps de réponse et la consommation.
Les restrictions produit
existantes continuent de s’appliquer : connecter un forfait ne réactive pas la V0
de devis complet. Les images et PDF sont envoyés en ligne lorsque nécessaires ;
leur prise en charge dépend du modèle choisi. Les métrés A (tableurs/CSV), B et C
(PDF) utilisent aussi le forfait du créateur en local. Leurs requêtes passent en
streaming. Les découpages PDF, limites de volume et validations métier restent
applicables. Les restrictions sur les versions de calcul restent inchangées.

Le lancement local exécute le worker Node sur le Mac après la réponse HTTP,
avec ses leases et sa persistance habituels. À la création, le job réserve
`execution_provider: chatgpt_local` et l’identifiant stable de ce Mac ; ces champs
sont immuables. Le cron partagé l’exclut et la base refuse sa prise en charge
par un ancien worker Gemini, même avec le rôle de service. Seul le RPC de claim
local peut le démarrer sur l’hôte réservé. Garder le serveur ouvert pendant
l’analyse.

Le lancement depuis un jeu de plans propose **Fournisseur IA** : Automatique ou
ChatGPT (forfait local). Les deux exigent une connexion et un modèle disponibles
sur ce Mac. Une ancienne préparation
enregistrée avec Gemini reste lisible, mais demande une nouvelle sélection et
confirmation avant lancement. Les résultats historiques restent consultables.

Sans compte sélectionné, l’analyse est refusée avant l’envoi de la source. Un
refus, un quota ou une panne ChatGPT ne déclenche aucun appel Gemini de secours.
Les traitements métier peuvent conserver leurs replis heuristiques existants.
Un métré ChatGPT en échec s’arrête sans relance automatique du forfait ni autre fournisseur.
Une perte de connexion ou un arrêt brutal n’autorise pas un changement de
fournisseur. Après expiration de lease, la reprise manuelle reste réservée au
Mac d’origine. Une déconnexion du forfait ou une membership révoquée bloque
l’analyse ; aucun autre compte n’est choisi.
Pour une relance manuelle, le forfait sélectionné pour le créateur sur son Mac
est utilisé ; changer de connexion entre deux tentatives change donc ce forfait.
Son résultat identifie `provider: chatgpt`, le modèle et les jetons consommés ;
`cost_cents: 0` signifie usage du forfait, sans prix API calculé.

Le chemin Gemini a été retiré : les anciennes tâches Gemini restent consultables
(listes, détail, exports), et toute relance ou reprise est refusée avant tout
traitement (`AI_PROVIDER`). La clé API personnelle est décrite plus bas ([Clé API OpenAI](#clé-api-openai)) ;
elle ne remplace jamais le forfait dans ces traitements. Ces
changements n'ont pas été déployés : le site hébergé et ses traitements déjà
enregistrés conservent leur fonctionnement tant qu'ils ne sont pas modifiés.
La fonctionnalité Decisions reste indépendante : si elle est déjà configurée,
elle utilise son accès API OpenAI distinct et sa facturation propre.

L'assistant de chiffrage (conversation sur une affaire, lecture seule) utilise
aussi ce forfait. Il s'active à part avec `MERGEONE_ASSISTANT=1` : voir
[Assistant de chiffrage](../metier/assistant.md).

## Stockage et frontières

- Jetons : `.private/chatgpt-local/` ignoré par Git, fichiers `0600`, dossier `0700`.
  Aucun jeton n’est enregistré dans Supabase, le navigateur ou les comptes rendus.
- Enregistrements séparés par utilisateur MergeOne et tenant actif. Plusieurs
  inscriptions ChatGPT sont distinctes même avec la même adresse email.
- La reprise durable d’un import utilise son créateur enregistré dans le tenant
  de la lease, après vérification de sa membership active. Une session du cron
  ne choisit jamais le forfait ; un créateur sans accès donne un repli heuristique.
- Le métré utilise `takeoff_jobs.created_by` et son tenant, avec vérification de
  la membership et du tenant actif avant chaque requête. Le compte et le modèle
  sont fixés au début du traitement : un changement interrompt les chunks suivants.
- Retour OAuth lié au cookie HTTP-only, état à usage unique, PKCE, nonce et jeton
  signé vérifié avec issuer/audience/expiration. Aucun nouveau client secret ni
  clé API n’est nécessaire. Les paramètres du retour ne sont pas journalisés.
- Le retour utilise l’hôte local vérifié même si Next.js normalise son URL interne
  en `localhost`. Les identifiants OAuth sont opaques ; la vérification d’identité
  repose sur le jeton signé et son audience, pas sur un préfixe d’identifiant.
- Un échec de connexion affiche une cause limitée et exploitable (session,
  expiration, inscription, échange ou identité). Les logs ne conservent que cette
  catégorie, sans paramètres OAuth ni réponse brute du fournisseur.
- Le lecteur conserve le texte des événements de flux : un événement final peut
  avoir `output: []`. Il ne valide la réponse qu’après `response.completed` avec
  le statut `completed`, puis validation métier ; un flux interrompu reste refusé.
- Renouvellement sérialisé entre processus ; rotation enregistrée atomiquement.
  Après un arrêt brutal, un dossier `.lock` peut subsister. Arrêter les processus
  MergeOne de ce checkout, vérifier le PID dans `.lock/pid`, puis supprimer
  uniquement ce verrou périmé. Conserver les fichiers JSON de connexion.
- Déconnexion : tentative de révocation distante, suppression locale des jetons,
  conservation de l’inscription pour reconnexion. En cas d’échec réseau, l’écran
  indique de déconnecter aussi l’application dans les paramètres ChatGPT.
- `NODE_ENV=production` désactive toujours cette intégration, même avec
  `MERGEONE_CHATGPT_LOCAL=1`. En développement, seuls la boucle locale au port
  du serveur et les hôtes de `MERGEONE_DEV_HOSTS` sont acceptés. Hors
  développement, l’opt-in CLI/test reste explicite et refusé sur Vercel ou CI.
  `npm run dev:chatgpt` lie l’écoute à `127.0.0.1` sauf `--hostname` explicite.

## Clé API OpenAI

« Mon profil › Accès IA » montre deux entrées : **Abonnement ChatGPT** (la source
par défaut, avec toutes ses commandes) et **Clé API**. Dans cette version, la clé
sert **uniquement au labo métré** ([guide du labo](takeoff-lab.md#clé-api-openai)) :
les autres traitements restent sur le forfait, et aucun ne passe de l’un à
l’autre. Un forfait expiré ou absent ne déclenche jamais d’appel sur la clé ; une
clé refusée ne bascule jamais sur le forfait.

- **Ajouter** : coller la clé dans le champ masqué, puis **Vérifier et
  enregistrer**. Le champ n’existe que sur l’adresse de boucle locale
  (`127.0.0.1`, `localhost`) : depuis un hôte de `MERGEONE_DEV_HOSTS`, servi en
  HTTP, la clé traverserait le réseau en clair ; la page indique alors l’adresse
  à ouvrir sur le Mac, et la route refuse aussi une clé reçue par un autre hôte.
  Limite : la page en décide d’après l’adresse affichée par le navigateur, et la
  route d’après l’en-tête `Host` et le protocole transmis ; ni l’un ni l’autre ne
  prouve l’interlocuteur réseau, et un proxy ou une redirection de port peut les
  faire diverger. C’est la décision du navigateur qui garde la clé hors du réseau ;
  un client qui forge ces en-têtes n’expose que sa propre clé. `npm run dev`
  (Next seul) écoute sur toutes les interfaces, `npm run dev:chatgpt` sur
  `127.0.0.1`.
  Le serveur lit le catalogue `GET /v1/models` (ni pièce jointe ni génération) ;
  accepté, l’état devient « Clé reconnue » et les modèles qualifiés que la clé
  liste sont retenus. Si OpenAI refuse la liste sans refuser la clé (403, ou 401
  sans code de refus définitif), la clé n’est pas déclarée invalide : l’écran dit
  qu’elle est peut-être restreinte, ou invalide, et propose le test annoncé d’un
  modèle ; la clé n’est enregistrée que si ce test réussit. Un refus définitif
  (`invalid_api_key`, `ip_not_authorized`, lus dans `error.code` comme dans
  `error.type`) reste « OpenAI a refusé cette clé ».
- **Tester le modèle** : un petit appel facturable, annoncé avec son plafond (au
  plus 0,10 $ US), sans document client. « Modèle testé le … » signifie seulement
  que cet appel a abouti.
- **Remplacer** vérifie la nouvelle clé, l’écrit dans **son propre élément** du
  Trousseau et la relit ; seulement alors le descriptif local bascule sur elle,
  par un renommage atomique, puis l’ancien élément est supprimé. Une
  vérification refusée, un Trousseau verrouillé, une écriture interrompue ou un
  échec du descriptif laissent la clé en service intacte et utilisable. Si la clé
  en service a été remplacée ou retirée pendant la vérification (autre onglet),
  rien n’est enregistré. **Retirer** enregistre d’abord que la clé n’est plus
  active, puis supprime son élément du Trousseau ; si cette suppression échoue,
  l’écran le dit et elle est refaite à la prochaine ouverture du Trousseau.
  Révoquer la clé chez OpenAI reste à faire dans le compte du fournisseur.
- Un descriptif local illisible compte comme « aucune clé enregistrée » : l’écran
  le dit, et un nouvel enregistrement le remplace.
- Dessiner « Mon profil » ou le labo n’ouvre pas le Trousseau et n’appelle pas
  OpenAI : l’état et les modèles viennent du descriptif local.
- Modèles proposés : l’intersection du catalogue de la clé et des modèles
  qualifiés et tarifés dans `src/lib/ai/access/openai-pricing.ts`. Barème
  Standard relevé le 18 novembre 2026 (recherches sur developers.openai.com :
  pages des modèles, tarifs, référence Responses, guide du cache de prompt) :
  GPT-6.1 Terra 1 / 0,05 / 5 $ US et GPT-6.1 Sol 2 / 0,10 / 10 $ US par million
  de jetons d’entrée, d’entrée en cache et de sortie ; une écriture en cache
  coûte 1,25 × l’entrée (30 min) ou 2,5 × (12 h) ; au-delà de 272 000 jetons
  d’entrée, toute la requête est facturée 2 × en entrée et 1,5 × en sortie. Un
  modèle sans tarif connu n’est ni proposé ni appelé.
- Chaque appel fixe `service_tier: "default"` (Standard) et demande
  `prompt_cache_options.mode: "explicit"` sans point de cache, donc aucune
  écriture ; une écriture annoncée est tout de même comptée à son tarif, d’après
  `cache_write_tokens_details.ttl_30m_tokens` (tout jeton écrit que ce compteur
  ne couvre pas est compté au tarif 12 h). Un niveau de service servi autre que
  Standard laisse le coût « à confirmer ».
- Le texte d’une réponse est décodé avant d’être masqué : la clé exacte et toute
  chaîne au format d’une clé OpenAI sont remplacées dans chaque valeur, rien
  d’autre (un texte de plan comme « Bearer bracket » reste tel quel).

Stockage et frontières de la clé :

- Le secret est dans le **Trousseau macOS** de ce Mac, élément
  `fr.mergeone.ai-api-key`, compte
  `<installation>:<utilisateur>:<tenant>:openai:v<version>` (un élément par clé
  enregistrée). Il passe par `/usr/bin/security` : écriture par l’entrée standard
  de `security -i` (hexadécimal), refusée si la commande sort en erreur, puis
  relue et comparée ; jamais en argument, variable d’environnement, fichier, URL
  ou journal. Au délai dépassé, le processus est tué et sa fin attendue avant la
  réponse. L’installation est l’identifiant de `.private/chatgpt-local/host.json`.
- Le descriptif nomme les éléments écrits pour une clé pas encore active
  (`pending`) et ceux à supprimer (`retired`) : toute opération qui ouvre le
  Trousseau (enregistrement, retrait, test, labo) les nettoie. Chaque clé
  enregistrée reçoit aussi un identifiant aléatoire, que les pages renvoient
  (voir le labo). Un verrou laissé par un processus arrêté (ou orphelin depuis
  30 s) est repris par un seul processus, qui vérifie d’abord qu’il s’agit bien
  du verrou jugé mort ; chacun ne libère que le verrou qui porte son jeton.
- Non vérifié sur un vrai Trousseau : les tests et le parcours utilisent un
  magasin en mémoire qui décode exactement ce que MergeOne écrit ; ils prouvent
  le câblage, pas le comportement de `security` (codes de sortie, mode
  interactif, verrouillage). Le premier enregistrement du propriétaire en est la
  première preuve.
- Trousseau verrouillé, ou boîte de déverrouillage sans réponse en 30 s :
  « Déverrouillez le Trousseau de ce Mac ». Sans Trousseau (Linux, version
  hébergée), l’entrée indique que la clé n’est disponible que sur l’installation
  Mac ; aucun stockage de repli n’existe.
- `.private/ai-access/` (fichiers `0600`) ne garde que le suffixe masqué, la
  version active, la vérification, les modèles listés, le dernier test, la
  dernière utilisation et les éléments en attente ou à retirer.
- Les routes `/api/ai-access/api-key` vérifient l’hôte local, la session, le
  tenant actif et, pour une écriture, l’origine de la page et un corps JSON. Ce
  ne sont pas des actions serveur : en développement, Next affiche les arguments
  d’une action serveur dans le terminal.
- Seul l’adaptateur `src/lib/ai/access/openai-api.ts` obtient la clé enregistrée
  et l’envoie, à `https://api.openai.com` sans suivre de redirection, avec
  `store: false` et une sortie bornée. Ses échecs sont des codes fermés aux
  messages français fixes ; il ne lit d’une réponse que le statut, un code
  d’erreur reconnu, l’identifiant de requête et `Retry-After`. Le texte qu’une
  réponse renvoie (réponse, identifiant de modèle, identifiant de requête) est
  masqué de la clé et de toute valeur au format d’une clé avant d’être lu ou
  stocké ; le rapporteur d’erreurs masque aussi ces valeurs, y compris dans la
  ligne qu’il journalise pour une exception non rattrapée.

Essai réel du propriétaire (hors CI) : lancer le labo comme indiqué dans son
guide, déconnecter ChatGPT si besoin, enregistrer la clé dans « Mon profil »,
**Tester le modèle**, puis dans le labo choisir le fournisseur **Clé API OpenAI**,
le plan fictif `army-chatgpt-plan` et lancer. Attendu : 12,5 m de tuyauterie et
quatre vannes en page 1, le modèle utilisé et un coût en $ US.

## Vérification

```sh
npx vitest run --project=node src/lib/ai/chatgpt-local-auth.test.ts src/lib/ai/chatgpt-local-inference.test.ts src/lib/ai/structured-ai.test.ts
npm run e2e:army:local -- --grep 'ChatGPT local'
npm run verify:pr
```

Les parcours TesterArmy démarrent un serveur local dédié contre la base éphémère
de la campagne. Ils sont répartis en deux fichiers, chacun avec son serveur, son
compte propriétaire, son port et son dossier d'artefacts
([`chatgpt-local-journey-support.ts`](../../e2e/army/local/chatgpt-local-journey-support.ts)) :

- [`chatgpt-local-takeoff.e2e.ts`](../../e2e/army/local/chatgpt-local-takeoff.e2e.ts) :
  règles du fournisseur local (LOCAL01 à LOCAL06), le lancement d’un second
  jeu de plans (LOCAL07), les trois parcours « ChatGPT local » et V3C08 ;
- [`chatgpt-local-decisions.e2e.ts`](../../e2e/army/local/chatgpt-local-decisions.e2e.ts) :
  assistance Decisions (DEC01, TRI01), écran Vecteurs du labo (VEC01), reprise
  des prix (PRX02) et réanalyse des pièces (INTRETRY01, INTWORD01).

Un seul fichier exécutait ces tests en série sur son serveur et fixait la durée
du check Critical. Les deux serveurs ne compilent jamais en même temps sur une
machine : les [jobs parallèles](tester-army-ci.md#jobs-parallèles) placent les
deux fichiers dans deux shards, et une sélection filtrée qui les contient tous
les deux est refusée avec plus d'un worker.

Le premier parcours « ChatGPT local » vérifie le départ OAuth et injecte un refus de
consentement. Le second téléverse un CSV fictif, lance le vrai worker local,
vérifie le résultat en base (12,5 m), le fournisseur, le modèle, les jetons et
l’absence d’appel Gemini ou Edge. Par défaut, le transport OpenAI est une fixture
explicite : cela ne prouve pas l’utilisation d’un abonnement réel.

Le serveur `next dev` de chaque fichier garde chaque route compilée jusqu’à la fin
du fichier (`onDemandEntries` de `next.config.ts`, réservé aux serveurs ayant un
`E2E_ARMY_DEV_SERVER_ID`). Avec l’abandon par défaut d’une route inactive depuis
60 s, un runner lent recompilait connexion, chiffrage et métré d’un test à
l’autre, jusqu’au redémarrage mémoire de Next (80 % du tas) au milieu de PRX02.

Ce serveur n’a pas de cache webpack persistant (`cache: false`, même bloc de
`next.config.ts`) : son `distDir` disparaît à la fin du fichier, et aucun serveur
suivant ne réutilise ce cache. Il était pourtant écrit dès que le compilateur
s’arrêtait, dans un paquet gzip de chaque module compilé (1,7 Gio en 19 s sur un
poste), puis relu à la compilation suivante. Sur un runner, ces écritures (0,9 à
2 Gio, 19 à 88 s chacune) et relectures bloquaient le serveur 16 à 27 s vers la fin
du fichier, dans INTWORD01 (TI-724) : +2,9 Go de mémoire hors tas, swap et
processeur saturés. Le cache mémoire de Next reste actif, et les résolutions de
modules y restent en cache (`resolve.cache`). Seul un redémarrage de ce serveur,
que le paquet aurait épargné, recompile désormais ses routes.

`chatgpt-<id>-resources.json`, dans les artefacts de la campagne, garde pour le
serveur de chaque fichier ChatGPT local l’échantillon mémoire de Next à chaque
requête (`requests` : instant, RSS et tas en Mo) et, sous Linux, une mesure par
seconde (`resources`) : mémoire disponible, swap utilisé, attentes mémoire,
processeur et disque (pressure stall information, `null` sans données du noyau),
RSS du serveur et de ses workers Next.

Pour une qualification réelle explicitement autorisée, le même parcours accepte
`.private/chatgpt-local-live-probe.json` dans un checkout de QA isolé, contenant
uniquement `accessToken`, `model`, `expiresAt` et le réglage `reasoningEffort`
d’un forfait connecté (jamais de
refresh token ni d’ID token). Le test exige un backend loopback, utilise le vrai
endpoint Responses, bloque Gemini et retire le profil temporaire en fin de run.
La preuve marque `livePlanInference: true` et conserve uniquement le modèle,
le nombre de jetons et les identifiants fictifs. Retirer le fichier privé après le run.
La connexion réelle reste une qualification distincte du refus OAuth injecté.

Le parcours `ChatGPT local: PDF plan` utilise aussi le plan fictif
`e2e/fixtures/takeoff/army-chatgpt-plan.pdf` et sa vérité terrain indépendante :
12,5 m de tuyauterie (segments de 5 m et 7,5 m) et quatre vannes. Il choisit
explicitement ChatGPT, vérifie les quantités, les unités, la page source,
la persistance et l’absence de transport Gemini. La qualification live du modèle
par défaut utilise `gpt-6.1-terra` et `reasoningEffort: "medium"`, sélectionné
depuis le profil puis vérifié après recharge et dans la requête Responses.
Le mode live décrit ci-dessus
fait réellement passer ce PDF au modèle du forfait ; le mode CI conserve une
réponse de fournisseur simulée et l’indique dans sa preuve.

Qualification réelle du 24 octobre 2026 : le plan PDF a produit 12,5 m de cuivre
et quatre vannes avec `gpt-6.1-sol` (1 982 jetons), via un seul appel OpenAI,
sans transport Gemini. Le navigateur, le stockage et la persistance utilisaient
une pile locale isolée. La correction de formats du bucket `takeoff-files` a
également été appliquée à la base partagée après autorisation du propriétaire ;
elle conserve les anciens formats, le caractère privé et la limite de 10 Mio.
Voir le [reçu de migration et de qualification PDF](shared-supabase-chatgpt-pdf-storage-2026-10-24.json).
