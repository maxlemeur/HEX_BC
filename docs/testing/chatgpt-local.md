# Forfait ChatGPT dans MergeOne local

La connexion personnelle utilise le flux officiel [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source).
Elle est réservée au serveur de développement sur ce Mac. L’activation sur un
site hébergé nécessite un accès OpenAI distinct ; ce changement ne l’active pas.

## Utilisation

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
leur prise en charge dépend du modèle choisi. Le worker de métré et ses batches
conservent leur fournisseur Gemini et nécessitent sa configuration habituelle.

Sans compte sélectionné, le fournisseur habituel est utilisé. Après sélection,
un refus, un quota ou une panne ChatGPT ne déclenche aucun appel Gemini de secours.
Les traitements métier peuvent conserver leurs replis heuristiques existants.

## Stockage et frontières

- Jetons : `.private/chatgpt-local/` ignoré par Git, fichiers `0600`, dossier `0700`.
  Aucun jeton n’est enregistré dans Supabase, le navigateur ou les comptes rendus.
- Enregistrements séparés par utilisateur MergeOne et tenant actif. Plusieurs
  inscriptions ChatGPT sont distinctes même avec la même adresse email.
- La reprise durable d’un import utilise son créateur enregistré dans le tenant
  de la lease, après vérification de sa membership active. Une session du cron
  ne choisit jamais le forfait ; un créateur sans accès donne un repli heuristique.
- Retour OAuth lié au cookie HTTP-only, état à usage unique, PKCE, nonce et jeton
  signé vérifié avec issuer/audience/expiration. Aucun nouveau client secret ni
  clé API n’est nécessaire. Les paramètres du retour ne sont pas journalisés.
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

Le parcours TesterArmy démarre un serveur local dédié contre la base éphémère
de la campagne, vérifie le départ OAuth et injecte un refus de consentement pour
vérifier la récupération. Il ne prouve pas une connexion ou une inférence réelle
avec un abonnement. La signature OIDC, l’isolation tenant, les renouvellements et
les erreurs de stream sont exercés avec des jetons et réponses de test explicites.
La connexion réelle puis **Tester la connexion** restent une qualification manuelle.
