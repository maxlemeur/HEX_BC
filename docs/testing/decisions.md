# Assistance de préparation et Decisions

La préparation reste entièrement disponible sans IA. L’assistance rédactionnelle
produit des champs et des questions sourcés, à reprendre explicitement dans le
brouillon. Elle utilise le compte ChatGPT sélectionné en développement local, ou
l’API Gemini déjà configurée en l’absence de ce choix. Un échec du compte ChatGPT
sélectionné ne bascule jamais sur une autre API. Les suggestions ne confirment ni
périmètre, ni source, ni convention. Elles ne produisent aucune quantité ou
calibration valide. Les données viennent du contexte disponible de l’affaire
(préparation, identité et métadonnées des sources, brief), sans lecture des
conversations personnelles ChatGPT.

Decisions constitue une capacité serveur distincte du routage Responses. Les
réglages du profil et la préparation affichent sa disponibilité et sa consommation
API séparée. Configurer uniquement côté serveur :

```dotenv
MERGEONE_OPENAI_DECISIONS=1
OPENAI_DECISIONS_API_KEY=<clé API dédiée>
```

Ne jamais placer ces valeurs dans une variable `NEXT_PUBLIC_*`, un artefact de test
ou le dépôt. Sans opt-in, aucun appel Decisions n’est effectué. Sans clé dédiée,
le statut est « non configuré ». La présence d’une clé ne prouve pas les droits,
le crédit ou le quota du compte : l’appel utilisateur peut encore échouer. Aucun
test automatique ne sonde des identifiants réels.

Le premier périmètre comprend :

- Intake : après l’extraction existante, Decisions propose une catégorie parmi les
  catégories du dossier. Les métadonnées et problèmes extraits sont conservés.
  La proposition impose la revue humaine et ne remplace pas un choix manuel.
- Préparation : classification proposée des pièces, ordre conseillé des questions
  ouvertes et prochaine action parmi les étapes admissibles. Les contrôles métier
  et les inconnues bloquantes restent calculés indépendamment du modèle.
- Cockpit : sur demande explicite, conseil parmi les candidats reconstruits côté
  serveur et encore visibles dans le cockpit. Les actions épinglées sont
  préservées. La réponse n’exécute rien et ne réordonne aucune liste en cours.

L’adaptateur utilise `gpt-6-luna` et `POST /v1/decisions`. Il valide séparément
chaque réponse, ses choix et ses scores. Une réponse absente, invalide ou refusée
reste à revoir ; les autres restent exploitables. Une erreur réseau, de quota ou
d’accès ne déclenche ni reprise automatique, ni autre fournisseur facturable.
L’empreinte de requête inclut le tenant, l’utilisateur, les sources et les choix.
Le cache du fournisseur est cloisonné par tenant et utilisateur. Les clés et les
erreurs brutes du fournisseur ne sont jamais renvoyées au navigateur.

Les suggestions acceptées conservent leur provenance bornée dans la préparation
et son instantané : affaire/tenant, révision, empreintes, date, fournisseur/modèle,
version de consigne, consommation et identifiants acceptés. Les propositions non
acceptées restent dans la réponse de l’assistant. Changer la préparation ou ses
sources invalide la proposition affichée ; une mutation conserve ses contrôles
d’accès et de concurrence habituels.

## Qualification

Les tests unitaires utilisent des réponses simulées et n’appellent pas OpenAI.
Ils couvrent le contrat transport, le cloisonnement, les candidats inconnus,
les refus partiels, les erreurs et la conservation des données confirmées.
La campagne navigateur déterministe valide la préparation manuelle sans accès IA.
Ces résultats ne prouvent ni l’accès réel à Decisions ni sa précision métier.

Un essai réel exige un accès configuré et autorisé, une affaire témoin du tenant
désigné et un budget API connu. Fixer les sources et la version du code, noter
les catégories/questions/actions attendues avant l’appel, puis consigner les
propositions, refus, consommation et corrections humaines. Ne pas qualifier la
précision à partir des seules probabilités du modèle. Aucun appel réel n’est
nécessaire pour vérifier le parcours manuel.

Références officielles vérifiées le 29 octobre 2026 :
[guide Decisions](https://developers.openai.com/api/docs/guides/decisions) et
[création d’une décision](https://developers.openai.com/api/reference/resources/decisions/methods/create).
