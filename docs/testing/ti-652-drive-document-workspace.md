# TI-652 — dossier documentaire et copies Drive

Le dossier d’affaire présente les pièces dans un tableau filtrable et recherchable.
Le détail donne le dossier et le fichier Drive d’origine, la révision, la date,
l’auteur de l’import et l’empreinte SHA-256. Le parcours Drive permet de naviguer
entre les dossiers, de conserver une sélection et de confirmer un lot unique.
Les résultats restent visibles par pièce, y compris en cas d’échec partiel.

La confirmation importe automatiquement une copie privée dans `affaire-intake`.
Une sélection seule ne transfère aucun fichier. Une même révision ne crée pas
une seconde copie active. Une autre révision demande une confirmation explicite.
Le parcours DPGF existant garde sa prévisualisation, son mapping et sa confirmation.

La suppression demande une confirmation et attend la fin du traitement du lot.
Elle supprime les octets de la pièce et de ses copies de plans, vérifie leur absence,
puis retire la pièce du dossier. Si elle avait été importée, le registre des pièces
manquantes et les plans synchronisés sont ensuite recalculés à partir des pièces restantes,
comme après un reclassement, ainsi que le brief courant tant qu’il reste une pièce importée.
L’original Drive et les lignes de chiffrage restent conservés. Les événements d’audit
sont immuables : une ligne technique marquée supprimée subsiste sans chemin de stockage.
Réimporter la même révision crée une nouvelle génération de stockage et une nouvelle
provenance finale.

Les opérations concurrentes utilisent une réservation avec reprise après deux
minutes et un jeton de clôture. Les copies de plans vérifient en base la génération
source. Le nettoyage après reclassement conserve ses métadonnées jusqu’à la
suppression Storage vérifiée, pour garder l’autorisation RLS et permettre la reprise.

## Qualification locale du 25 octobre 2026

Sources : branche existante `codex/ti-652-drive-folder-navigation`, synchronisée
par fusion avec `origin/main` à `a3de99e5` (dernier ajout : reçus de documentation uniquement). La liste des fichiers candidats et leurs
empreintes est conservée dans `outputs/ti652-validation/candidate-source-final.json`.
Node 26.12.1 ; dépendances installées par `npm ci` ; Supabase CLI verrouillé 2.121.0.
Les campagnes utilisent un checkout sans `.env` et une pile native éphémère détenue
par le runner. Aucun backend partagé ni document Google privé n’est utilisé.

- `npm run supabase:types` : 41 fichiers SQL, 2 486 assertions réussies, matrice RLS
  et plafonds de statements réussis, types générés après nettoyage de la pile.
- Relecture indépendante du diff : aucun P1/P2 restant dans le périmètre revu.
- `NPM_CONFIG_CACHE=/private/tmp/ti652-npm-cache npm run verify:pr` : réussi,
  3 702 tests Node et 853 tests UI réussis ; 3 tests ignorés et 6 todo conservés ;
  12 tests de couverture critique réussis (98,03 % de lignes, 95,45 % de branches).
- Campagne native DRV01/DRV02 : réussie (2 parcours + authentification).
  DRV02 repris avec écrans stabilisés : réussi (1 parcours + authentification).
  Reçus et archives dans `outputs/ti652-validation/receipt.md`.

DRV01 vérifie l’API/UI quand OAuth est désactivé. DRV02 utilise les fonctions réelles
de persistance et de suppression avec le client propriétaire authentifié et la RLS
locale : octets téléchargés identiques, absence de doublon, deux révisions,
provenance après rechargement, annulation puis confirmation de suppression dans
l’UI, absence des deux objets de stockage, conservation de l’autre révision,
isolation du tenant et réimport après suppression. Les métadonnées Drive sont
fictives ; le consentement Google, les appels Google et l’extraction du worker ne
sont pas couverts par cette campagne. Le classement de la fixture est fixé sous RLS.

Les premiers essais échoués sont conservés dans le reçu : fixture de plan créée
après le transfert (corrigée pour respecter la RLS), chemin SQL de fixture invalide
(corrigé), cache npm non accessible (cache temporaire dédié), paramètre devenu inutilisé
et bundle de preuve détectés par ESLint (paramètre retiré et preuves archivées). Ils ne constituent
pas des réussites de qualification.

## Activation partagée

Les cinq migrations `20261025190729` à `20261025192608` restent à appliquer sur le
backend partagé avant tout déploiement de ce code. Elles sont append-only et
répertoriées dans le manifest. Le push Git ne déploie pas Vercel.

L’accès Google réel nécessite la configuration et la validation OAuth existantes
(`MERGEONE_GOOGLE_DRIVE_ENABLED`, `MERGEONE_GOOGLE_DRIVE_CLIENT_ID`). Les tokens
restent en mémoire côté client, ne sont pas enregistrés en base et peuvent être
révoqués depuis l’interface. Les limites existantes restent de 50 Mo par fichier,
20 pièces et 100 Mo par lot ; les formats Google natifs et Drives partagés restent
hors du périmètre actuel.
