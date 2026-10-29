# Forfait ChatGPT dans MergeOne local

La connexion personnelle utilise le flux officiel [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source).
Elle est réservée au serveur de développement sur ce Mac. L’activation sur un
site hébergé nécessite un accès OpenAI distinct ; ce changement ne l’active pas.

## Utilisation

La migration `20261023222150_chatgpt_local_takeoff_execution.sql` est requise
sur la base utilisée par le Mac pour lancer un métré ChatGPT. Son application
sur une base partagée demande une autorisation distincte. Tant qu’elle manque,
le lancement est refusé avant le téléversement et aucun job Gemini n’est créé.
La migration `20261029152340_local_chatgpt_safe_recovery.sql` est également
nécessaire pour la reprise locale des tâches expirées et du dossier. Sur une base
qui ne l’a pas reçue, la reprise échoue sans appeler les anciennes fonctions de
reprise Gemini ; ne l’appliquer à une base partagée qu’après autorisation séparée.

1. Utiliser le Node de `.nvmrc`, puis lancer `npm run dev:chatgpt`.
2. Ouvrir `http://127.0.0.1:3000/dashboard/profile` et se connecter à MergeOne.
   Si le port 3000 est occupé, utiliser `npm run dev:chatgpt -- --port 3015`
   et ouvrir cette même adresse avec le port 3015. Utiliser `127.0.0.1`, pas `localhost`.
3. Dans **Mon forfait ChatGPT**, choisir **Continue with ChatGPT** et consentir
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

Les formulaires de téléversement et de lancement depuis un jeu de plans proposent
**Fournisseur IA** : Automatique ou ChatGPT (forfait local). Les deux exigent
une connexion et un modèle disponibles sur ce Mac. Une ancienne préparation
enregistrée avec Gemini reste lisible, mais demande une nouvelle sélection et
confirmation avant lancement. Les résultats historiques restent consultables.

Sans compte sélectionné, l’analyse est refusée avant l’envoi de la source. Un
refus, un quota ou une panne ChatGPT ne déclenche aucun appel Gemini de secours.
Les traitements métier peuvent conserver leurs replis heuristiques existants.
Un métré ChatGPT en échec s’arrête sans escalade Gemini ni retry automatique.
Une perte de connexion ou un arrêt brutal n’autorise pas un changement de
fournisseur. Après expiration de lease, la reprise manuelle reste réservée au
Mac d’origine. Une déconnexion du forfait ou une membership révoquée bloque
l’analyse ; aucun autre compte n’est choisi.
Pour une relance manuelle, le forfait sélectionné pour le créateur sur son Mac
est utilisé ; changer de connexion entre deux tentatives change donc ce forfait.
Son résultat identifie `provider: chatgpt`, le modèle et les jetons consommés ;
`cost_cents: 0` signifie usage du forfait, sans prix API calculé.

Les anciennes tâches Gemini ne sont plus lancées ni réconciliées par cette
version. Les intégrations par clé personnelle sont hors de ce lot. Ces
changements n'ont pas été déployés : le site hébergé et ses traitements déjà
enregistrés conservent leur fonctionnement tant qu'ils ne sont pas modifiés.
La fonctionnalité Decisions reste indépendante : si elle est déjà configurée,
elle utilise son accès API OpenAI distinct et sa facturation propre.

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
- `NODE_ENV=production`, Vercel ou CI désactivent cette intégration, même avec
  `MERGEONE_CHATGPT_LOCAL=1`. Le lancement dédié lie le serveur à la boucle locale.

## Vérification

```sh
npx vitest run --project=node src/lib/ai/chatgpt-local-auth.test.ts src/lib/ai/chatgpt-local-inference.test.ts src/lib/ai/structured-ai.test.ts
npm run e2e:army:local -- --grep 'ChatGPT local'
npm run verify:pr
```

Les parcours TesterArmy démarrent un serveur local dédié contre la base éphémère
de la campagne. Le premier vérifie le départ OAuth et injecte un refus de
consentement. Le second téléverse un CSV fictif, lance le vrai worker local,
vérifie le résultat en base (12,5 m), le fournisseur, le modèle, les jetons et
l’absence d’appel Gemini ou Edge. Par défaut, le transport OpenAI est une fixture
explicite : cela ne prouve pas l’utilisation d’un abonnement réel.

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
