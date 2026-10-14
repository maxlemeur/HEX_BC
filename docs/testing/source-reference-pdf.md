# Validation PDF terminable — contrat et preuve locale

Le contrat et les tests ont été écrits avant le code dans
`.e2e/source-coverage/pdf-staged/`. Après la qualification de reprise des ouvrages,
le module et les mêmes assertions sont intégrés aux sources. Les 17 tests
passent avec de vrais Workers Node24.19.0 sous Windows ; lint et types passent.
Aucune route, fixture DB, benchmark ou dépendance supplémentaire n'est créée
par ce module. HTTP, Storage et packaging d'une route restent à qualifier.

Le contrat HTTP primaire demeure `docs/testing/source-coverage-reference.md`,
notamment SR-03/SR-04/SR-05 : octets réellement lus, privés puis relus, empreinte,
taille, pages, pas d’upload/attestation/activation sur échec. Ce dossier couvre
uniquement les frontières que le navigateur ne peut observer directement.

## API intégrée

Module : [source-reference-pdf.ts](../../src/lib/estimates/source-reference-pdf.ts),
serveur Node uniquement, sans dépendance à l'auth, Storage, DB ou interface.

```ts
type InspectedSourceReferencePdf = {
  bytes: ArrayBuffer;
  byteSize: number;
  pageCount: number;
};
async function inspectSourceReferencePdf(
  bytes: ArrayBuffer,
  options?: { signal?: AbortSignal }
): Promise<InspectedSourceReferencePdf>;

type SourceReferencePdfErrorCode =
  | "PDF_EMPTY" | "PDF_TOO_LARGE" | "PDF_INVALID" | "PDF_ENCRYPTED"
  | "PDF_PAGE_LIMIT" | "PDF_TIMEOUT" | "PDF_ABORTED"
  | "PDF_WORKER_FAILURE" | "PDF_WORKER_PROTOCOL";
class SourceReferencePdfError extends Error {
  readonly code: SourceReferencePdfErrorCode;
  readonly requiresSourceRead: boolean;
}
```

La fonction consomme un `ArrayBuffer` possédé exclusivement par l’appelant,
jamais le backing buffer entier d’un Buffer Node partagé/poolé. Les adaptateurs
de lecture bornée doivent fournir le segment exact, sans octets voisins. Rejeter
un buffer détaché comme vide. Ne pas accepter un `SharedArrayBuffer` ni une vue
tronquée à la place du contrat. Le caller ne touche plus le buffer après appel.

- Taille réellement reçue : 1..52 428 800 octets inclus. Le flux HTTP/Storage
  doit déjà être abandonné dès le dépassement ; cette garde en mémoire reste
  une seconde frontière, pas une autorisation de télécharger sans borne.
- Pages : entier 1..200 inclus. Rejeter PDF protégé/chiffré même si le mot de
  passe lecteur est vide. Aucun mot de passe dans l’API, aucun `ignoreEncryption`.
- Parser uniquement dans un vrai Worker Node terminable, compter les pages
  sans extraction de texte, OCR, rendu de pages, scripts PDF ni accès réseau.
- Délai total de la tâche : 15 000 ms de temps réel, démarrage du worker compris.
  L’API publique n’accepte pas de durée supérieure ni de limites choisies par
  le navigateur. Ne pas attendre un message « ready » avant de démarrer le délai.
- Worker : `resourceLimits.maxOldGenerationSizeMb = 256`, pile séparée 4 MiB.
  Cette option limite l’ancienne génération V8 ; elle ne garantit **ni** 256 MiB
  de heap total, **ni** RSS, **ni** buffers externes, **ni** mémoire globale sous
  concurrence. Pas de promesse RSS, pas de test OOM volontaire sur le process hôte.
- Transférer le même buffer au worker (`transferList`), puis rendre ses octets
  par transfert dans le message de succès. Pas de sérialisation d’un nouveau PDF,
  pas de `.slice()` de 50 MiB pour conserver une copie de confort.
- Calculer SHA-256 avant transfert et sur le buffer rendu pour refuser une
  mutation ou substitution ; ces empreintes ne nécessitent pas de clone.
  Le service HTTP calcule/emploie son hash d’attestation sur les octets récupérés.
- Résoudre/rejeter seulement après sortie confirmée du worker, y compris succès,
  timeout, abort, crash et protocole invalide. Le handler attendu ne dépend pas
  d’une réponse coopérative du parseur : `terminate()` coupe sa boucle CPU.
- Toute erreur après transfert porte `requiresSourceRead:true` : le buffer
  appelant est détaché, les octets doivent être relus depuis la source autorisée
  pour réessayer, avec la même clé de préparation. Prévalidation/abort préalable
  ne détachent pas les octets et portent `requiresSourceRead:false`.
- Erreurs publiques fixes, sans stack, chemin local, locator, message brut du
  parseur ou texte du document. Un crash de worker ne devient pas un PDF invalide
  supposé : c’est une panne temporaire (HTTP503), pas un diagnostic documentaire.
- Aucun uploader n’appartient à ce module ; le chemin HTTP doit rester après
  cette promesse. Zéro octet uploadé sur tout rejet, à prouver par le futur E2E.

## Protocole worker strict

Un seul résultat, schéma exact :

```ts
type Result =
  | { ok: true; bytes: ArrayBuffer; byteSize: number; pageCount: number }
  | { ok: false; code: "PDF_INVALID" | "PDF_ENCRYPTED" | "PDF_PAGE_LIMIT" };
```

Valider le type, les clés, le buffer rendu, les entiers/bornes, l’égalité
`byteSize === bytes.byteLength === originalByteSize` et l’empreinte. Refuser
objets inattendus, Uint8Array/SharedArrayBuffer au lieu du buffer, code inconnu,
résultat absent, octets altérés et champs supplémentaires. Ne jamais transmettre
un `error.message` brut du worker. Aucune URL ni module demandé par l’utilisateur.

Le worker résout `pdf-lib/dist/pdf-lib.min.js` avec `createRequire` ancré au
projet. Ce fichier doit être inclus dans la trace serveur de la future route :
le test Node ne prouve pas son packaging Next. Le worker tabulaire existant
reste séparé : il extrait du texte et ne rend pas les octets. Les flux du
nouveau worker sont drainés sans exposer les diagnostics du parseur ; il
n'hérite ni des secrets d'environnement ni des options V8 du serveur.

## Écart E2E justifiant les tests spécialisés écrits avant code

| Cas | Défaillance concrète | Pourquoi le HTTP normal ne suffit pas |
| --- | --- | --- |
| W1 | CPU infini continue après timeout, bloque le process ou worker encore vivant quand la promesse rejette | Une 503 ne prouve pas la fin du thread. Le test utilise un vrai Worker en boucle, un témoin SharedArrayBuffer réservé à la fixture et `threadId === -1` au settlement. |
| W2 | Abort après démarrage ne termine pas le parseur | Le navigateur fermé ne peut confirmer que son worker serveur est mort. Même preuve réelle d’exit, pas de fake timers. |
| W3 | Crash/exit sans résultat laisse la promesse suspendue ou divulgue la stack | Une panne déterministe du process n’est pas injectée par un endpoint privilégié. La fixture crashe un vrai worker ou termine sans message. |
| W4 | Message valide suivi d’une boucle laisse un worker vivant malgré le succès | L’HTTP voit les faits PDF mais pas la ressource restante. Le faux parseur envoie le vrai protocole puis bloque ; le vrai superviseur doit terminer le thread. |
| W5 | Protocole incohérent, buffer tronqué/substitué ou code forgé accepté | Ces fautes internes ne proviennent pas fiablement de PDFs ordinaires. La fixture injecte uniquement un script Worker, sans mock de terminate ni d’horloge. |
| W6 | Un résultat réel du parseur clone/mute les octets ou oublie de terminer le worker | Le test d’un PDF minimal par le vrai parser observe input détaché, hash/taille/pages et worker terminé. L’E2E ne peut observer la propriété de l’ArrayBuffer. |

L’export de test suit le précédent local `tabular-pdf-extraction.__testing__` :
`runSourceReferencePdfWorker(bytes,{timeoutMs,signal?,createWorker?})` et
`createSourceReferencePdfWorker(bytes):Worker`. Factory **synchrone**, Node
uniquement ; la version publique utilise toujours la factory et la durée fixes.
Ce seam ne doit pas devenir un endpoint ni recevoir un script depuis l’utilisateur.
Les tests ne mockent pas l’API Worker et ne testent pas du forwarding statique.

Les bornes 0/1/200/201 pages et 50 MiB ±1, le PDF vraiment chiffré et les fichiers
malformés restent surtout des fixtures de la future matrice HTTP. Pas de tests
isolés supplémentaires qui répètent uniquement ces réponses HTTP observables.

## Corpus préparé

[pdf-fixtures.ts](../../src/test/fixtures/source-reference-pdf/pdf-fixtures.ts)
contient des fabriques en mémoire : PDF 1/200/201 pages, zéro page explicite,
pseudo-PDF sans catalogue, cycle de
page tree, marqueur Encrypt, document avec espaces de fin jusqu’à une taille
exacte. Les pages sont vides : ce sont des frontières techniques, pas les CCTP
visuels A/B de l’oracle et aucune validation métier humaine n’est prétendue.

Le cas Encrypt construit un dictionnaire déclaré de chiffrement pour vérifier
le refus de cette déclaration ; **ce n’est pas un fichier réellement chiffré**.
`.e2e/source-coverage/pdf-staged/make-encrypted-fixture.py` prépare séparément
un vrai PDF protégé avec pypdf,
vérifie `is_encrypted`, l’ouverture avec mot de passe et la page, écrit hash/taille.
Exécuté le 12 octobre avec le Python du runtime Codex et pypdf : corpus
`.e2e/source-coverage/pdf-staged/encrypted-corpus-20261012/`, SHA256 PDF
`1dc3a3ccc1d1b528d15ccdd1bf86bcb202bfbe79d8f1894c6e1670c8b60a60cd`.
Le manifeste vérifie le chiffrement et une page après déchiffrement avec la
constante de fixture non sensible. Aucun appel au module produit, à Storage
ou à une route HTTP n'a été exécuté pour cette fixture.

HTTP futur doit observer : PDF 1 et 200 accepté ; 201→limite ; 0/invalid→invalide ;
Encrypt et vrai chiffré→invalide source ; 50 MiB accepté selon budgets ; +1 rejeté
pendant le flux ; cycle pathologique terminé sans upload ; substitution après
upload détectée lors de relecture. Qualifier les branches réellement exécutées.

## Exécution et limites de preuve

Les tests préécrits passent d'abord sur le candidat : archive
`.e2e/source-coverage/pdf-staged/runs/worker-20261011T220658Z/manifest.json`,
SHA256 `161283f2c7e741497b383c76719a0b262b335404c2dec753b40e6f268e806838`.
Ils passent ensuite intégrés, dans le projet Vitest `node`, sans filtre de cas :
`npm test -- src/lib/estimates/source-reference-pdf.test.ts --project=node`.
La fixture de faute est passée de CJS à ESM et son chemin a suivi ; la lecture
TypeScript d'une limite optionnelle est ajustée sans changer l'assertion à 256.
Les premiers diagnostics lint/types sont conservés, puis les contrôles finaux
passent (`worker-integrated-final.log`, `worker-lint-final.log`,
`worker-typecheck-final.log` dans le dossier staged).

Archive intégrée : `.e2e/source-coverage/pdf-staged/runs/integrated-20261011T2215Z/manifest.json`,
SHA256 `0a32f016e46b4300a67e80e4af1966b78faef2bfebd7fa20751c43ace9fe77b0`.
Elle conserve sources, assertions, fixture, commandes, version et journaux.

Chaque assertion de cycle de vie observe threadId positif au démarrage,
événement exit, puis threadId -1 au settlement. Les deux transferts réussis
comparent réellement SHA/taille et détachement de l'entrée. Une seule tâche
CPU bloquée à la fois, délai injecté 2s et garde externe 10s ; le finally termine
tout worker restant si un test échoue. Aucun débit ni RSS n'est mesuré.

Le parseur réel est éprouvé sur un PDF d'une page. Les autres bornes du corpus,
le vrai PDF chiffré et les parcours HTTP/Storage ci-dessus restent à exécuter.
Ne pas transformer ces 17 tests en preuve d'hébergement, de charge ou de copie
conservée. Les limites Node sont décrites dans la
[documentation officielle des workers 24.x](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html).
