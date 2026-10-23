# Forfait ChatGPT dans MergeOne local

La connexion personnelle utilise le flux officiel [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source).
Elle est réservée au serveur de développement sur ce Mac. L’activation sur un
site hébergé nécessite un accès OpenAI distinct ; ce changement ne l’active pas.

## Utilisation

La migration `20261023222150_chatgpt_local_takeoff_execution.sql` est requise
sur la base utilisée par le Mac pour lancer un métré ChatGPT. Son application
sur une base partagée demande une autorisation distincte. Tant qu’elle manque,
le lancement est refusé avant le téléversement et aucun job Gemini n’est créé.

1. Utiliser le Node de `.nvmrc`, puis lancer `npm run dev:chatgpt`.
2. Ouvrir `http://127.0.0.1:3000/dashboard/profile` et se connecter à MergeOne.
   Si le port 3000 est occupé, utiliser `npm run dev:chatgpt -- --port 3015`
   et ouvrir cette même adresse avec le port 3015. Utiliser `127.0.0.1`, pas `localhost`.
3. Dans **Mon forfait ChatGPT**, choisir **Continue with ChatGPT** et consentir
   à l’utilisation du forfait avec un compte éligible. Choisir ensuite un modèle
   parmi ceux réellement disponibles pour ce compte.
4. **Tester la connexion** envoie une courte demande réelle, qui utilise le
   forfait. **Gérer ma consommation** ouvre les limites dans ChatGPT.

Les appels interactifs de classement des documents, brief, génération d’ouvrages,
structure et explication utilisent le compte sélectionné. Les restrictions produit
existantes continuent de s’appliquer : connecter un forfait ne réactive pas la V0
de devis complet. Les images et PDF sont envoyés en ligne lorsque nécessaires ;
leur prise en charge dépend du modèle choisi. Les métrés A (tableurs/CSV), B et C
(PDF) utilisent aussi le forfait du créateur en local. Leurs requêtes passent en
streaming ; un réglage Gemini batch ne soumet pas de batch lorsque ChatGPT est
sélectionné. Les découpages PDF, limites de volume et validations métier restent
applicables. Les restrictions sur les versions de calcul restent inchangées.

Le lancement local exécute le worker Node sur le Mac après la réponse HTTP,
avec ses leases et sa persistance habituels. À la création, le job réserve
`execution_provider: chatgpt_local` et l’identifiant stable de ce Mac ; ces champs
sont immuables. Le cron partagé l’exclut et la base refuse sa prise en charge
par un ancien worker Gemini, même avec le rôle de service. Seul le RPC de claim
local peut le démarrer sur l’hôte réservé. Garder le serveur ouvert pendant
l’analyse. Les batches Gemini déjà acceptés continuent leur réconciliation
habituelle ; ils ne sont pas renvoyés à ChatGPT.

Sans compte sélectionné, le fournisseur habituel est utilisé. Après sélection,
un refus, un quota ou une panne ChatGPT ne déclenche aucun appel Gemini de secours.
Les traitements métier peuvent conserver leurs replis heuristiques existants.
Un métré ChatGPT en échec s’arrête sans escalade Gemini ni retry automatique.
Une perte de connexion ou un arrêt brutal n’autorise pas un changement de
fournisseur. Après expiration de lease, la reprise manuelle reste réservée au
Mac d’origine. Une déconnexion du forfait ou une membership révoquée bloque
l’analyse ; aucun autre compte n’est choisi.
Son résultat identifie `provider: chatgpt`, le modèle et les jetons consommés ;
`cost_cents: 0` signifie usage du forfait, sans prix API calculé.

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
uniquement `accessToken`, `model` et `expiresAt` d’un forfait connecté (jamais de
refresh token ni d’ID token). Le test exige un backend loopback, utilise le vrai
endpoint Responses, bloque Gemini et retire le profil temporaire en fin de run.
La preuve marque `livePlanInference: true` et conserve uniquement le modèle,
les jetons et les identifiants fictifs. Retirer le fichier privé après le run.
La connexion réelle reste une qualification distincte du refus OAuth injecté.
