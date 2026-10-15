# Détection des échecs de reprise durable

Contrat défini avant implémentation le 15 octobre 2026. Périmètre : la commande
du workflow `recover-durable-fallback.yml`, sans modification du statut HTTP de
l'API, des leases, des tentatives ni de la politique de livraison des e-mails.

## Défaillances observables et lacune E2E

Le workflow existant utilise `curl -fsS` : un HTTP 200 est vert même si la réponse
contient `failedCount`, `deadCount` ou les erreurs d'un drain. Les drains peuvent
aussi capturer une panne globale en `errors` tout en laissant `failed` à zéro.
Le seul test HTTP de la route vérifie le refus sans secret. Les parcours navigateur
ne lancent pas ce planificateur et ne peuvent donc pas établir le code de sortie,
les annotations GitHub, le délai réseau ou l'absence de fuite de son processus.

Exception d'isolation : exercer **la vraie commande Node du workflow**, dans un
sous-processus, contre un serveur HTTP jetable lié exclusivement à `127.0.0.1`.
Chaque réponse est une fixture du contrat réel. Aucun fournisseur, secret réel,
Supabase, e-mail ou cron distant n'est appelé. La recette produit des assertions
de code de sortie, requête reçue et sortie standard/erreur ; elle ne qualifie pas
le fonctionnement effectif des files ni la configuration distante.

Avant code, les scénarios à reproduire sont : réponse saine ; erreur de drain
avec compteurs nuls ; échec d'élément ; budget épuisé ; absence normale de travail
et report de capacité ; drain indisponible ; JSON malformé, incomplet ou avec
types invalides ; HTTP refusé, redirection, interruption et timeout ; réponse
trop volumineuse ; configuration manquante/invalide ; données confidentielles
dans le corps ou une erreur qui ne doivent jamais apparaître dans les logs.

## Politique de signalement

| Résultat | Signal et code de sortie |
|---|---|
| Compteurs sains ; email `skipped=true` sans travail/erreur ; `skippedCount` de capacité | Résumé numérique, succès 0. Le report de capacité reste visible. |
| Échecs individuels comptabilisés, sans budget épuisé ni erreur globale | Annotation `warning`, résumé numérique, succès 0 **dégradé**. |
| `deadCount` ou `emailOutbox.dead` positif | Annotation `error`, échec 1. |
| Erreur de drain sans échec individuel comptabilisé ; échecs email sans acteur (`failed > claimed`) ; drain Storage ignoré | Annotation `error`, échec 1. |
| Email ignoré avec erreur ou compteurs non nuls | Annotation `error`, échec 1. |
| HTTP non 2xx, redirection, réseau/délai, corps trop gros, JSON/contrat invalide, configuration invalide | Message constant sans corps/URL/secret, annotation `error`, échec 1. |

Le contrat actuel ne distingue pas une erreur individuelle transitoire d'une
configuration incorrecte au moment de livrer un élément. **Un warning ne prouve
donc pas que l'erreur est retryable.** Il indique une reprise partielle à examiner.
Les erreurs individuelles restent visibles sans déclencher une nouvelle alerte
externe à chaque tentative. Le script ne relance pas lui-même la requête : les
reprises restent sous le contrôle des files existantes. Une erreur terminale ou
globale fait échouer cette exécution. La détection d'un backlog ancien ou d'une
dégradation persistante entre deux runs reste hors de ce lot.

Les sorties ne contiennent que noms de catégories fixes, compteurs validés et
booléens. Ni corps brut, identifiant métier, texte d'erreur fournisseur, URL,
header d'autorisation, fichier temporaire de réponse ni artefact sensible.

## Exécution et preuve

Commande prévue :

```text
npm test -- --project=node src/test/durable-recovery-command.test.ts
```

Le sous-processus reçoit uniquement une origine loopback, un jeton factice et les
variables système nécessaires à Node. Le délai est borné (280 s par défaut), le
corps à 256 Kio ; les redirections sont refusées. En exploitation, seules les
origines HTTPS sont acceptées ; HTTP est réservé aux adresses loopback exactes
pour cette recette. La commande n'utilise aucune dépendance npm.

Résultats locaux du 15 octobre 2026, Node `24.19.0`, Vitest `4.1.11` :

- Première tentative bloquée avant les assertions par un `EPERM` du cache
  Vitest dans le sandbox : **preuve manquante**, conservée dans `red.log`.
- Même commande hors sandbox, avant création du script : **36/36 rouges**
  (`red-elevated.log`). Le cas de référence exécute aussi l'ancien `curl -fsS`
  contre un HTTP 200 contenant une panne globale de drain : son code est bien 0.
- Après implémentation : **36/36 verts**, mêmes assertions et même commande
  (`green.log`). Les fixtures couvrent aussi secret/header reçus exactement une
  fois, redirection non suivie, corps interrompu et aucune fuite des sentinelles.
- ESLint sur les deux nouveaux fichiers de code et `git diff --check` ciblé : PASS.

Preuves privées reproductibles : `.e2e/tech-debt-recovery-detection-20261015/`.
`manifest.json` enregistre commande, révision, état local, versions, codes de
sortie et empreintes des copies de sources conservées dans `sources/`.

La qualification établit la détection et le signal du processus utilisé par le
workflow. Elle ne prouve ni une livraison d'e-mail, ni un nettoyage Storage, ni
une alerte reçue, ni la configuration ou l'exécution réelle du cron GitHub.
