# Retrait ponctuel d’un devis accepté vide

Cette procédure prépare un cas de maintenance expressément autorisé ; elle ne
constitue pas une fonctionnalité de suppression générale. La migration installe
une fonction temporaire en schéma privé, exécutable uniquement par postgres.
Aucune identité de production n’est inscrite dans la migration. Ne pas l’exécuter sur une base
partagée avant revue et validation indépendantes.

Avant l’appel, identifier et verrouiller le périmètre de l’autorisation : tenant,
affaire, version, jeu de plans, fichier, identifiants de tous les événements de
version et de toutes les entrées d’audit associées. Les arguments sont vérifiés
exactement ; tout changement ou toute référence étrangère non prévue fait échouer
la transaction. La fonction exige notamment une seule version de l’affaire, acceptée,
sans sceau et sans ligne, ainsi qu’un seul jeu et un seul fichier de plan.

L’appel détache le jeu de plans, conserve la ligne du fichier et les métadonnées
Storage existantes sans modifier les objets,
vérifie que chaque événement possède une copie JSON complète et identique dans
le journal d’audit, puis supprime la version. Les événements de version sont
supprimés par leur cascade normale ; leur identité et leur contenu restent dans
`audit_logs`. Les journaux précédents restent consultables par l’administrateur
du tenant. Cette transaction ne vérifie ni la présence ni le contenu des octets
du fichier. Une entrée supplémentaire indique la maintenance postgres.

Le garde de suppression n’est remplacé que dans la transaction qui tient le
verrou des versions, pour la cible vérifiée. Sa définition, son propriétaire et
ses droits sont restaurés et comparés avant le commit. Toute erreur annule les
changements. Une entrée d’audit, protégée par un verrou consultatif, rend la
capacité utilisable une seule fois, même pour deux cibles différentes. Une
réponse incertaine impose de vérifier l’état avant toute reprise.

L’appelant doit exécuter une seule transaction courte, sans interaction humaine
entre ses instructions : `BEGIN; SET LOCAL statement_timeout = '10s'; SELECT
private.retire_empty_accepted_legacy_estimate(...); COMMIT;`. Toute erreur exige
un rollback et une vérification de l’état avant une nouvelle tentative. Le délai
de dix secondes est une limite de sûreté, pas une durée observée.

La fonction prend sans attente un verrou `SHARE ROW EXCLUSIVE` sur
`public.estimate_versions`, `private.estimate_purchase_receipts`,
`private.estimate_purchase_transfers`, `private.estimate_source_coverage_events`
et `storage.objects`, ainsi que des verrous de ligne sur l’affaire, le devis,
le jeu de plans, les fichiers, les événements et les audits concernés. Si une
ressource est déjà occupée, l’opération échoue sans attendre. Une fois acquis,
ces verrous bloquent les écritures concurrentes sur ces tables, tous tenants
confondus, jusqu’au commit : mesurer la durée en environnement local et prévoir
une courte fenêtre de maintenance avant l’appel réel.

Dans une pile locale jetable, le test à plusieurs sessions a observé une
transaction de 161 ms, dont 100 ms d’attente volontaire pour constater les
écritures concurrentes bloquées. Cette mesure ne prédit pas la durée en
production et ne remplace pas le `statement_timeout` de l’appelant.

Après succès, vérifier indépendamment l’absence de la version, la conservation
de l’affaire, du jeu, du fichier, des objets Storage et des journaux, ainsi que
la définition et les droits du garde. Créer ensuite une nouvelle migration avec
la CLI Supabase pour retirer la capacité devenue inutilisable :

```sql
revoke all on function private.retire_empty_accepted_legacy_estimate(uuid, uuid, uuid, uuid, uuid, uuid[], uuid[]) from public, anon, authenticated, service_role;
drop function private.retire_empty_accepted_legacy_estimate(uuid, uuid, uuid, uuid, uuid, uuid[], uuid[]);
```

Ne pas appliquer cette migration de retrait avant l’opération. La génération des
types et le manifeste doivent correspondre à chaque état livré. Les sauvegardes,
les éventuels liens non déclarés par clé étrangère et les accès parallèles sont
à examiner avant l’exécution ; une comparaison des clés étrangères seule ne
prouve pas l’absence de références dans du JSON ou dans un système externe.
