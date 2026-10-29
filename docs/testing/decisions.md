# Assistance de préparation et Decisions

La préparation reste entièrement disponible sans IA. L’assistance rédactionnelle
produit des champs et des questions sourcés, à reprendre explicitement dans le
brouillon. Elle utilise le compte ChatGPT sélectionné en développement local.
Un échec du compte ChatGPT ne bascule jamais vers une autre API facturable.
Les suggestions ne confirment ni
périmètre, ni source, ni convention. Elles ne produisent aucune quantité ou
calibration valide. Les données viennent du contexte disponible de l’affaire
(préparation, identité et métadonnées des sources, brief), sans lecture des
conversations personnelles ChatGPT.

Decisions constitue une capacité serveur distincte du routage Responses. Les
réglages du profil et la préparation affichent sa disponibilité et sa consommation
API séparée. Configurer uniquement côté serveur :

```dotenv
MERGEONE_OPENAI_DECISIONS=0
MERGEONE_INTAKE_DECISIONS=0
OPENAI_DECISIONS_API_KEY=
```

Ce bloc est prêt à être configuré, sans activation et sans dépense. Les modèles
et les données ne sont pas envoyés au fournisseur pour vérifier la configuration.
Pour activer plus tard le classement autonome, il faut une autorisation de dépense,
une clé API dédiée dans l’environnement privé et les deux indicateurs à `1`.
La seule présence d’une clé ou l’activation de Decisions dans un autre parcours
ne suffit pas à activer le classement des documents.

Ne jamais placer une clé dans une variable `NEXT_PUBLIC_*`, un artefact de test
ou le dépôt. Sans opt-in, aucun appel Decisions n’est effectué. Sans clé dédiée,
le statut est « non configuré ». La présence d’une clé ne prouve pas les droits,
le crédit ou le quota du compte : l’appel utilisateur peut encore échouer. Aucun
test automatique ne sonde des identifiants réels.

Le premier périmètre comprend :

- Intake : lorsque les deux opt-ins sont actifs et la clé configurée, Decisions
  classe directement le contenu préparé localement. ChatGPT n’est pas un préalable,
  même si sa connexion est absente ou échoue. Les PDF sont lus dans un processus
  séparé, arrêté à l’échéance de 15 secondes, avec limites de pages, texte et image
  (le plafond de heap V8 ne constitue pas un plafond de mémoire native totale) :
  deux premières pages, texte limité et aperçu JPEG de la première page
  pour un document scanné. L’aperçu utilise le module canvas optionnel de PDF.js ;
  sans celui-ci, le texte reste exploitable et une pièce scannée reste à classer.
  Les textes/tableurs utilisent leurs extraits bornés existants ; les images
  PNG/JPEG/WebP jusqu’à 1,5 Mo sont transmises comme images. Aucun PDF brut n’est
  envoyé à Decisions. Sans contenu exploitable, aucun appel payant n’est lancé.
  Les métadonnées existantes sont conservées. La catégorie est une proposition
  « À vérifier », y compris si le modèle est confiant. Un refus reste à classer ;
  un échec conserve le secours par nom, sans appel automatique à un autre fournisseur.
  Une sélection explicite de Decisions avec une configuration incomplète bloque
  la relance et ne revient pas silencieusement vers ChatGPT.
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

Les relances unitaires, par sélection et globales utilisent le même classement.
La disponibilité de Decisions peut les autoriser même sans ChatGPT local.
Les gardes tenant/projet, source manuelle, date de modification manuelle, suppression
et concurrence restent appliquées avant la relance et lors de l’écriture du résultat.
« Valider » garde la décision humaine et actualise ensuite le dossier et le brief.

## Validation manuelle de l’intégration autonome

Aucun test ni appel fournisseur n’a été lancé pour cette modification, conformément
à la demande du propriétaire. La préparation de configuration laisse les opt-ins
désactivés. Après une activation explicitement autorisée et un budget convenu,
relancer une seule pièce non manuelle à la fois : PDF avec texte, PDF scanné, image
et tableur. Répéter avec ChatGPT déconnecté pour constater l’indépendance.
Vérifier la proposition, son maintien « À vérifier », le refus/échec éventuel,
la conservation des métadonnées et des classements manuels, puis confirmer via
« Valider ». Les autres formats restent en classement manuel si aucun extrait
local n’est disponible. Aucun résultat simulé ne prouve la précision métier.

Les suggestions acceptées conservent leur provenance bornée dans la préparation
et son instantané : affaire/tenant, révision, empreintes, date, fournisseur/modèle,
version de consigne, consommation et identifiants acceptés. Les propositions non
acceptées restent dans la réponse de l’assistant. Changer la préparation ou ses
sources invalide la proposition affichée ; une mutation conserve ses contrôles
d’accès et de concurrence habituels.

## Qualification

La couverture historique utilise des réponses simulées et n’appelle pas OpenAI.
Ils couvrent le contrat transport, le cloisonnement, les candidats inconnus,
les refus partiels, les erreurs et la conservation des données confirmées.
La campagne navigateur déterministe valide la préparation manuelle sans accès IA.
Ces résultats ne qualifient pas la modification autonome actuelle et ne prouvent
ni l’accès réel à Decisions ni sa précision métier.

Un essai réel exige un accès configuré et autorisé, une affaire témoin du tenant
désigné et un budget API connu. Fixer les sources et la version du code, noter
les catégories/questions/actions attendues avant l’appel, puis consigner les
propositions, refus, consommation et corrections humaines. Ne pas qualifier la
précision à partir des seules probabilités du modèle. Aucun appel réel n’est
nécessaire pour vérifier le parcours manuel.

Références officielles vérifiées le 29 octobre 2026 :
[guide Decisions](https://developers.openai.com/api/docs/guides/decisions) et
[création d’une décision](https://developers.openai.com/api/reference/resources/decisions/methods/create).
