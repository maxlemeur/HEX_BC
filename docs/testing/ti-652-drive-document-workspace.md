# TI-652 — dossier documentaire et liens Google Drive

## Modèle depuis le 28 octobre 2026 : comptes conservés, pièces liées sans copie

Un compte Google ajouté par un membre reste enregistré pour ses prochaines visites,
dans toutes ses affaires du tenant actif. Les comptes sont personnels : un autre
membre, même administrateur, ne les voit pas et ne peut pas les utiliser. Le panneau
Drive permet de choisir le compte, de parcourir Mon Drive, les fichiers partagés
avec le membre (par exemple le Drive d’un collègue) et les Drives partagés.

Une affaire peut mémoriser son dossier Drive : le panneau s’ouvre directement dessus
à chaque retour, et repart de Mon Drive si le compte choisi n’y a plus accès.

Une pièce choisie dans Drive n’est plus copiée dans `affaire-intake`. MergeOne
enregistre un lien : identifiant du fichier, dossier d’origine, révision lue, compte
qui l’a lié. Le classement lit le fichier dans Drive avec le compte de ce membre,
dans les mêmes limites qu’avant (50 Mo par fichier, 20 fichiers par lien, formats
du dépôt local), et vérifie que la révision n’a pas changé pendant la lecture.
Une modification ultérieure dans Drive n’est pas réanalysée automatiquement.
Un même fichier n’est lié qu’une fois par affaire ; retirer le lien laisse le
fichier dans Drive et permet de le lier à nouveau.

Retirer un compte efface le jeton et révoque l’accès chez Google, sauf si le même
compte Google reste connecté ailleurs dans MergeOne (autre tenant ou autre membre) :
Google révoque en une fois tous les jetons d’un compte. Les pièces déjà liées restent
dans l’affaire ; les sélectionner de nouveau dans Drive les rattache au compte choisi,
sans nouvelle pièce. Un compte dont Google a révoqué l’accès est signalé « à
reconnecter ». Un membre retiré d’un tenant perd les comptes Google ajoutés dans ce
tenant, et le classement ne lit plus jamais un fichier avec le compte d’un ancien membre.

Une DPGF liée depuis Drive s’importe depuis le dossier comme une copie : le serveur la
lit dans Drive au moment de la revue PDF et de l’import, avec le compte du membre qui
l’a liée ; le navigateur n’en reçoit que le nom et la taille actuelle. La version
importée est celle présente dans Drive à ce moment, et l’import est refusé si le format
du fichier a changé depuis son lien. Comme tout import, il conserve son fichier source
dans `dpgf-imports`, y compris après le retrait du lien. Si l’accès Google du compte
qui a lié le fichier a expiré, le message demande à son membre de le reconnecter.

Les plans liés depuis Drive ne sont pas encore envoyés au métré et ne lèvent pas la
pièce manquante « plans ». Décision de Thanh (28/10/2026) : ils garderont une copie de
travail réservée au métré, supprimée avec le lien, à construire maintenant que la
refonte de la synchronisation des plans est fusionnée.

### Sécurité

- Connexion OAuth côté serveur (code + PKCE, `access_type=offline`, portée
  `drive.readonly`). L’état est scellé dans un cookie `httpOnly` lié au membre et
  au tenant, valable 10 minutes ; le retour ne porte qu’un code de résultat.
- Le refresh token est chiffré par l’application (AES-256-GCM, données associées :
  tenant, membre, compte Google) avant d’entrer en base, dans `private`, lisible
  seulement par le service role. Le navigateur ne reçoit jamais de jeton Google.
- Seul le retour OAuth enregistre un compte, par le service role, pour le membre et le
  tenant qu’il a vérifiés : un membre ne peut pas déclarer un compte Google par son
  identifiant (ce qui ferait passer le compte d’un collègue pour partagé et éviterait sa
  révocation).
- En base, un membre ne peut lier un fichier ou un dossier qu’avec un compte à lui
  (trigger `zzz_guard_google_drive_connection_reference`) : un autre rédacteur de
  l’affaire ne peut pas faire lire le Drive d’un collègue au worker.
- Chaque opération revérifie l’appartenance au tenant et l’accès à l’affaire avant
  d’utiliser un jeton.

### Configuration d’un environnement

Variables (toutes requises, avec le service role ; sinon Drive reste désactivé) :

- `MERGEONE_GOOGLE_DRIVE_ENABLED=true`
- `MERGEONE_GOOGLE_DRIVE_CLIENT_ID` et `MERGEONE_GOOGLE_DRIVE_CLIENT_SECRET` d’un
  client OAuth « Application Web » ;
- `MERGEONE_GOOGLE_DRIVE_TOKEN_KEY` : 32 octets aléatoires en base64
  (`openssl rand -base64 32`). En changer oblige les membres à ajouter de nouveau
  leurs comptes.

Dans Google Cloud, déclarer comme URI de redirection autorisée
`<origine>/api/google-drive/oauth/callback` pour chaque origine (local et production),
et la portée `https://www.googleapis.com/auth/drive.readonly` sur l’écran de
consentement. Cette portée donne la lecture de tout le Drive du compte : son
activation sur un environnement réel reste soumise à validation.

La migration `20261029000932_google_drive_links` est à appliquer sur le backend
partagé avant le déploiement de ce code.

### Vérifications

- Unitaires (Google simulé) : persistance d’un compte sans exposer son jeton,
  renouvellement de l’accès, navigation Partagés avec moi / Drives partagés, lien
  unique sans téléchargement, échecs partiels, dossier d’affaire, compte d’un autre
  membre refusé, reconnexion, révocation, jeton scellé pour un autre compte refusé,
  lecture bornée par le classement ; parcours OAuth (état, cookie, refus, portée,
  accès durable, retour) ; panneau Drive.
- pgTAP `google-drive-links.test.sql` : comptes visibles par leur seul membre,
  jeton illisible et fonction de lecture réservée au service role, enregistrement
  réservé au service role et à un membre du tenant, lien ou dossier refusé avec le compte d’un autre membre,
  pas de copie stockée pour un lien, lien unique actif, retrait puis nouveau lien,
  isolation du tenant, suppression d’un compte qui conserve les pièces (y compris
  retirées), compte Google partagé signalé au serveur, comptes retirés avec le membre.
- TesterArmy DRV01 (Drive désactivé, aucun jeton accepté depuis le navigateur) et
  DRV02 (liens sous RLS locale réelle, sans copie, conservés après rechargement,
  retrait confirmé dans l’UI, nouveau lien). Métadonnées Drive et jeton fictifs :
  le consentement Google, les appels Google et la lecture par le worker ne sont pas
  couverts par ces campagnes.

## Historique : copies Drive (qualification du 25 octobre 2026)

Avant le 28 octobre, une pièce Drive était copiée dans `affaire-intake` avec un jeton
gardé en mémoire dans le navigateur, à redemander à chaque visite. Aucune copie Drive
n’existait sur le backend partagé au 28/10/2026, donc aucune reprise de données n’est
nécessaire. La politique Storage de vérification des copies Drive en attente est
retirée par la migration du 28 octobre.

La suppression d’une pièce (copie locale ou lien) demande une confirmation et attend
la fin du traitement du lot. Pour une copie locale, elle supprime les octets de la
pièce et de ses copies de plans et vérifie leur absence. Le registre des pièces
manquantes, les plans synchronisés et le brief courant sont ensuite recalculés à partir
des pièces restantes. Les événements d’audit sont immuables : une ligne technique
marquée supprimée subsiste sans chemin de stockage.

Les opérations concurrentes utilisent une réservation avec reprise après deux
minutes et un jeton de clôture. Les copies de plans vérifient en base la génération
source.
