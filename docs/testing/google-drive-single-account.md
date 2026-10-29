# Compte Drive personnel dans MergeOne

Contrat : un compte Google par membre dans son entreprise active. La première
connexion autorise la lecture. Une autorisation facultative `drive.file` permet
les écritures sur les fichiers choisis dans Google Picker ; elle doit appartenir
au même compte Google et ne remplace pas le jeton de lecture.

Le profil permet de connecter, reconnecter, désactiver l'écriture et retirer le
compte. Un retrait conserve les liens et copies existants. La révocation distante
Google est manuelle car elle peut affecter toutes les connexions du même compte.
Le consentement à l'écriture Google et l'autorisation effective dans MergeOne sont
distincts : désactiver l'écriture supprime son jeton côté serveur.

Échecs à couvrir avant livraison : substitution de compte ou de tenant, accès à
une connexion d'un autre membre, deux retours concurrents créant deux comptes,
retour OAuth tardif après retrait/désactivation, version affichée périmée,
renouvellement lent, permission Google plus large que demandée, refus Google,
réponse réseau tardive et désactivation pendant une opération. Une opération commencée
peut aboutir malgré une désactivation concurrente : le dernier contrôle de droits
et l’appel à Google ne forment pas une transaction atomique.

Les opérations d'écriture sont explicites : commentaire et renommage d'un fichier
choisi. Elles vérifient le droit Google du fichier et le mode enregistré juste
avant leur envoi. Elles ne constituent pas un éditeur complet de Docs/Sheets/Slides.

La migration s'arrête si plusieurs comptes existent déjà pour un membre ; elle
ne choisit pas et ne supprime pas ses données à sa place. Les anciens serveurs
doivent être arrêtés avant l'ouverture du nouveau parcours.

Pour l'activation : appliquer la migration, configurer OAuth en lecture Drive,
activer Google Picker sur le même projet et renseigner
`MERGEONE_GOOGLE_PICKER_API_KEY` et `MERGEONE_GOOGLE_CLOUD_PROJECT_NUMBER`.
Limiter la clé Picker aux origines prévues et à l'API utilisée. L'absence de ces
deux paramètres conserve la lecture et masque la demande d'écriture.

La recette automatisée sépare les preuves : les tests SQL utilisent une base
locale éphémère ; le navigateur exécute le vrai composant avec Google et l'API
simulés. Elle ne prouve pas le consentement d'un compte Google réel. Un brouillon
reste en mémoire pendant les erreurs, sans garantie de reprise après navigation
ou rechargement de la page.
